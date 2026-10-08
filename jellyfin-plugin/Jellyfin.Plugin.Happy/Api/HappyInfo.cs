namespace Jellyfin.Plugin.Happy.Api;

/// <summary>
/// Plugin info returned by <c>GET /Happy/Info</c>.
/// </summary>
/// <param name="Version">Plugin version.</param>
public sealed record HappyInfo(string Version);
