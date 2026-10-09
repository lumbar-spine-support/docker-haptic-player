namespace Jellyfin.Plugin.Happy.Funscripts;

/// <summary>
/// A funscript file attached to a media item.
/// </summary>
/// <param name="Key">Opaque key the client uses to request the file.</param>
/// <param name="FileName">File name including the extension; the client parses type and subcategory from it.</param>
/// <param name="Path">Absolute path on the server; never sent to clients.</param>
internal sealed record FunscriptFile(string Key, string FileName, string Path);
