using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using Jellyfin.Data.Enums;
using Jellyfin.Plugin.Happy.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Happy.Funscripts;

/// <summary>
/// In-memory index of funscripts per library item.
/// </summary>
/// <remarks>
/// Jellyfin does not track <c>.funscript</c> files, so the index walks the library folders itself.
/// It is rebuilt after every library scan and lazily when older than <see cref="MaxAge"/>, so scripts
/// added without a media change still show up shortly after. Only the libraries selected in the plugin
/// configuration are indexed (all when none are selected).
/// </remarks>
public sealed class FunscriptIndex
{
    /// <summary>
    /// Maximum age of the index before a request triggers a rebuild.
    /// </summary>
    internal static readonly TimeSpan MaxAge = TimeSpan.FromSeconds(30);

    private static readonly EnumerationOptions ScriptSearch = new()
    {
        RecurseSubdirectories = true,
        IgnoreInaccessible = true,
        MatchCasing = MatchCasing.CaseInsensitive,
    };

    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<FunscriptIndex> _logger;
    private readonly Lock _buildLock = new();
    private Snapshot? _snapshot;

    /// <summary>
    /// Initializes a new instance of the <see cref="FunscriptIndex"/> class.
    /// </summary>
    /// <param name="libraryManager">Instance of the <see cref="ILibraryManager"/> interface.</param>
    /// <param name="logger">Instance of the <see cref="ILogger{FunscriptIndex}"/> interface.</param>
    public FunscriptIndex(ILibraryManager libraryManager, ILogger<FunscriptIndex> logger)
    {
        _libraryManager = libraryManager;
        _logger = logger;
    }

    /// <summary>
    /// Gets the scripts per item id, rebuilding first if the index is missing or stale.
    /// </summary>
    /// <returns>Scripts per item id.</returns>
    internal IReadOnlyDictionary<Guid, List<FunscriptFile>> Current()
    {
        var snapshot = _snapshot;
        if (snapshot is not null
            && Stopwatch.GetElapsedTime(snapshot.BuiltAt) < MaxAge
            && snapshot.Libraries.SequenceEqual(SelectedLibraries()))
        {
            return snapshot.Scripts;
        }

        return Rebuild();
    }

    /// <summary>
    /// Rebuilds the index now. Concurrent callers wait for and share a single build.
    /// </summary>
    /// <returns>Scripts per item id.</returns>
    internal IReadOnlyDictionary<Guid, List<FunscriptFile>> Rebuild()
    {
        var requestedAt = Stopwatch.GetTimestamp();
        lock (_buildLock)
        {
            if (_snapshot is { } fresh && fresh.BuiltAt >= requestedAt && fresh.Libraries.SequenceEqual(SelectedLibraries()))
            {
                return fresh.Scripts;
            }

            var started = Stopwatch.GetTimestamp();
            var separator = Plugin.Instance?.Configuration.FunscriptSeparator is { Length: > 0 } s ? s : ".";
            var libraries = SelectedLibraries();
            var folders = _libraryManager.GetVirtualFolders();
            var selected = folders.Where(f => Guid.TryParse(f.ItemId, out var id) && libraries.Contains(id)).ToList();

            // Like GET /Happy/Config: no selected library that still exists means all libraries.
            var roots = (selected.Count > 0 ? selected : folders)
                .SelectMany(f => f.Locations)
                .Where(Directory.Exists)
                .Distinct(StringComparer.Ordinal)
                .ToList();
            var media = _libraryManager.GetItemList(new InternalItemsQuery
                {
                    MediaTypes = [MediaType.Audio, MediaType.Video],
                    IsFolder = false,
                    Recursive = true,
                })
                .Where(i => !string.IsNullOrEmpty(i.Path))
                .Select(i => new MediaFile(i.Id, i.Path))
                .ToList();

            // Match per library folder so the "same stem anywhere" fallback never crosses libraries.
            var scripts = new Dictionary<Guid, List<FunscriptFile>>();
            foreach (var root in roots)
            {
                var prefix = Path.TrimEndingDirectorySeparator(root) + Path.DirectorySeparatorChar;
                var rootMedia = media.Where(m => m.Path.StartsWith(prefix, StringComparison.Ordinal));
                var rootScripts = Directory.EnumerateFiles(root, "*" + FunscriptMatcher.Extension, ScriptSearch);
                foreach (var (id, files) in FunscriptMatcher.Match(rootMedia, rootScripts, separator))
                {
                    if (scripts.TryGetValue(id, out var existing))
                    {
                        existing.AddRange(files.Where(f => !existing.Exists(e => e.Key == f.Key)));
                    }
                    else
                    {
                        scripts[id] = files;
                    }
                }
            }

            _snapshot = new Snapshot(scripts, libraries, Stopwatch.GetTimestamp());
            _logger.LogInformation(
                "Indexed funscripts for {ItemCount} of {MediaCount} media items in {RootCount} library folders ({ElapsedMs} ms)",
                scripts.Count,
                media.Count,
                roots.Count,
                (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds);
            return scripts;
        }
    }

    private static IReadOnlyList<Guid> SelectedLibraries()
        => ClientSettings.ParseLibraryIds(Plugin.Instance?.Configuration.LibraryIds);

    /// <summary>
    /// One build of the index; <see cref="Libraries"/> are the selected libraries it covers, so a changed
    /// selection rebuilds it right away.
    /// </summary>
    private sealed record Snapshot(Dictionary<Guid, List<FunscriptFile>> Scripts, IReadOnlyList<Guid> Libraries, long BuiltAt);
}
