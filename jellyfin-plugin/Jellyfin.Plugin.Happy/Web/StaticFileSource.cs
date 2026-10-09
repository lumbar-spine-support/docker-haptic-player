using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;

namespace Jellyfin.Plugin.Happy.Web;

/// <summary>
/// Read-only files the plugin serves: resources embedded in the assembly under a prefix (<c>web/</c>,
/// <c>docs/</c>), or, for the local dev Jellyfin, a directory named by an environment variable so edits
/// show up without rebuilding the plugin.
/// </summary>
public sealed partial class StaticFileSource
{
    private readonly Assembly? _assembly;
    private readonly string _prefix;
    private readonly string? _directory;

    private StaticFileSource(Assembly? assembly, string prefix, string? directory)
    {
        _assembly = assembly;
        _prefix = prefix;
        _directory = directory;
    }

    /// <summary>
    /// Gets a value indicating whether files come from a directory instead of the assembly.
    /// </summary>
    public bool IsDirectory => _directory is not null;

    /// <summary>
    /// Creates a source over the directory in <paramref name="environmentVariable"/> when it is set and
    /// exists, and over the embedded resources named <c>&lt;prefix&gt;/…</c> otherwise.
    /// </summary>
    /// <param name="environmentVariable">Dev override, e.g. <c>HAPPY_DEV_WEB_ROOT</c>.</param>
    /// <param name="prefix">Logical name prefix of the embedded resources, without slash.</param>
    /// <returns>The file source.</returns>
    public static StaticFileSource Create(string environmentVariable, string prefix)
    {
        var directory = Environment.GetEnvironmentVariable(environmentVariable);
        return !string.IsNullOrEmpty(directory) && Directory.Exists(directory)
            ? FromDirectory(directory)
            : FromAssembly(typeof(StaticFileSource).Assembly, prefix);
    }

    /// <summary>
    /// Creates a source over embedded resources whose logical names start with <c>&lt;prefix&gt;/</c>.
    /// </summary>
    /// <param name="assembly">The assembly holding the resources.</param>
    /// <param name="prefix">Logical name prefix, without slash.</param>
    /// <returns>The file source.</returns>
    public static StaticFileSource FromAssembly(Assembly assembly, string prefix)
        => new(assembly, prefix.TrimEnd('/') + "/", null);

    /// <summary>
    /// Creates a source over a directory.
    /// </summary>
    /// <param name="directory">The directory.</param>
    /// <returns>The file source.</returns>
    public static StaticFileSource FromDirectory(string directory)
        => new(null, string.Empty, Path.GetFullPath(directory));

    /// <summary>
    /// Checks that a relative path only walks down through ordinary names: no <c>..</c>, no dotfiles,
    /// no backslashes, no empty segments.
    /// </summary>
    /// <param name="path">Relative path with forward slashes.</param>
    /// <returns>Whether the path may be served.</returns>
    public static bool IsSafePath(string path)
        => !string.IsNullOrEmpty(path) && path.Split('/').All(segment => SafeSegment().IsMatch(segment));

    /// <summary>
    /// Opens a file.
    /// </summary>
    /// <param name="path">Relative path with forward slashes.</param>
    /// <returns>The file stream, or null when the path is unsafe or the file does not exist.</returns>
    public Stream? Open(string path)
    {
        if (!IsSafePath(path))
        {
            return null;
        }

        if (_directory is not null)
        {
            var full = Path.GetFullPath(Path.Combine(_directory, path));
            return full.StartsWith(_directory + Path.DirectorySeparatorChar, StringComparison.Ordinal) && File.Exists(full)
                ? File.OpenRead(full)
                : null;
        }

        return _assembly?.GetManifestResourceStream(_prefix + path);
    }

    /// <summary>
    /// Lists the files directly in the root (not in subdirectories).
    /// </summary>
    /// <returns>File names.</returns>
    public IEnumerable<string> ListRoot()
    {
        if (_directory is not null)
        {
            return Directory.Exists(_directory)
                ? Directory.EnumerateFiles(_directory).Select(Path.GetFileName).OfType<string>()
                : [];
        }

        return (_assembly?.GetManifestResourceNames() ?? [])
            .Where(name => name.StartsWith(_prefix, StringComparison.Ordinal))
            .Select(name => name[_prefix.Length..])
            .Where(name => !name.Contains('/', StringComparison.Ordinal));
    }

    [GeneratedRegex(@"^[A-Za-z0-9_@-][A-Za-z0-9._@-]*$")]
    private static partial Regex SafeSegment();
}
