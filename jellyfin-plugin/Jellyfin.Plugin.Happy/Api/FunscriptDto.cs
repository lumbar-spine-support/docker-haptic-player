namespace Jellyfin.Plugin.Happy.Api;

/// <summary>
/// A funscript as listed to clients.
/// </summary>
/// <param name="Key">Key for <c>GET /Happy/Items/{itemId}/Funscripts/{key}</c>.</param>
/// <param name="FileName">Script file name; HAPPY parses type and subcategory from it.</param>
public sealed record FunscriptDto(string Key, string FileName);
