namespace Jellyfin.Plugin.Happy.Api;

/// <summary>
/// Plugin info returned by <c>GET /Happy/Info</c>; HAPPY shows it as its version.
/// </summary>
/// <param name="Version">Plugin version (HAPPY's version plus <c>.0</c>).</param>
/// <param name="Channel"><c>stable</c> for release builds, <c>dev</c> for Debug builds.</param>
/// <param name="Commit">Git commit the plugin was built from, when the build stamped it.</param>
/// <param name="BuiltAt">Build time (ISO 8601), when the build stamped it.</param>
public sealed record HappyInfo(string Version, string Channel, string? Commit, string? BuiltAt);
