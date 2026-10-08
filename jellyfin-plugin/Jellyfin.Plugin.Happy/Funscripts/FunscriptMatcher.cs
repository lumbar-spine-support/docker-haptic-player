using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Jellyfin.Plugin.Happy.Funscripts;

/// <summary>
/// Assigns funscript files to media files by name, without knowing any script type suffixes.
/// </summary>
/// <remarks>
/// A script <c>a.b.c.funscript</c> belongs to the media whose file stem is the longest
/// separator-bounded prefix of <c>a.b.c</c> (<c>a.b.c</c>, then <c>a.b</c>, then <c>a</c>).
/// A match in the script's own directory wins; otherwise the script is attached to every
/// media file with that stem anywhere in the scanned set. Stems compare case-insensitively.
/// Parsing the type and subcategory out of the remaining suffix is left to the HAPPY client.
/// </remarks>
internal static class FunscriptMatcher
{
    /// <summary>
    /// The funscript file extension.
    /// </summary>
    public const string Extension = ".funscript";

    /// <summary>
    /// Matches scripts to media files.
    /// </summary>
    /// <param name="media">Media items with their absolute file paths.</param>
    /// <param name="scripts">Absolute paths of candidate funscript files.</param>
    /// <param name="separator">Separator between the media stem and the script suffixes.</param>
    /// <returns>Scripts per media item id, sorted by file name; items without scripts are absent.</returns>
    public static Dictionary<Guid, List<FunscriptFile>> Match(
        IEnumerable<MediaFile> media,
        IEnumerable<string> scripts,
        string separator)
    {
        ArgumentException.ThrowIfNullOrEmpty(separator);

        var byDirAndStem = new Dictionary<string, List<Guid>>(StringComparer.OrdinalIgnoreCase);
        var byStem = new Dictionary<string, List<Guid>>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in media)
        {
            var stem = Path.GetFileNameWithoutExtension(item.Path);
            Add(byDirAndStem, DirKey(Path.GetDirectoryName(item.Path), stem), item.Id);
            Add(byStem, stem, item.Id);
        }

        var result = new Dictionary<Guid, List<FunscriptFile>>();
        foreach (var script in scripts)
        {
            var fileName = Path.GetFileName(script);
            if (!fileName.EndsWith(Extension, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var candidates = CandidateStems(fileName[..^Extension.Length], separator);
            var dir = Path.GetDirectoryName(script);
            var owners = candidates.Select(c => byDirAndStem.GetValueOrDefault(DirKey(dir, c))).FirstOrDefault(o => o is not null)
                ?? candidates.Select(c => byStem.GetValueOrDefault(c)).FirstOrDefault(o => o is not null);
            if (owners is null)
            {
                continue;
            }

            var file = new FunscriptFile(KeyFor(script), fileName, script);
            foreach (var id in owners)
            {
                if (!result.TryGetValue(id, out var list))
                {
                    list = [];
                    result[id] = list;
                }

                list.Add(file);
            }
        }

        foreach (var list in result.Values)
        {
            list.Sort((a, b) => StringComparer.OrdinalIgnoreCase.Compare(a.FileName, b.FileName));
        }

        return result;
    }

    /// <summary>
    /// Gets a short stable key for a script path, so clients never send file paths back.
    /// </summary>
    /// <param name="path">Absolute script path.</param>
    /// <returns>16 lowercase hex characters.</returns>
    internal static string KeyFor(string path)
        => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(path)))[..16];

    /// <summary>
    /// Gets the candidate media stems for a script body, longest first.
    /// </summary>
    /// <param name="body">Script file name without the extension.</param>
    /// <param name="separator">Suffix separator.</param>
    /// <returns>The body itself, then each prefix ending before a separator.</returns>
    internal static List<string> CandidateStems(string body, string separator)
    {
        var candidates = new List<string> { body };
        for (var i = body.LastIndexOf(separator, StringComparison.Ordinal); i > 0; i = body.LastIndexOf(separator, i - 1, StringComparison.Ordinal))
        {
            candidates.Add(body[..i]);
        }

        return candidates;
    }

    private static string DirKey(string? dir, string stem) => (dir ?? string.Empty) + "\0" + stem;

    private static void Add(Dictionary<string, List<Guid>> map, string key, Guid id)
    {
        if (!map.TryGetValue(key, out var list))
        {
            list = [];
            map[key] = list;
        }

        list.Add(id);
    }
}
