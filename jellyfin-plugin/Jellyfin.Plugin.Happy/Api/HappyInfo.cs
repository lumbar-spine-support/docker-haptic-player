using System;

namespace Jellyfin.Plugin.Happy.Api;

/// <summary>
/// Plugin info returned by <c>GET /Happy/Info</c>; HAPPY shows it as its version.
/// </summary>
/// <param name="Version">Plugin version (HAPPY's version plus <c>.0</c>, or plus the build number for beta builds).</param>
/// <param name="Channel"><c>stable</c> for releases, <c>beta</c> for beta builds, <c>dev</c> for Debug builds.</param>
/// <param name="Commit">Git commit the plugin was built from, when the build stamped it.</param>
/// <param name="BuiltAt">Build time (ISO 8601), when the build stamped it.</param>
public sealed record HappyInfo(string Version, string Channel, string? Commit, string? BuiltAt)
{
    /// <summary>
    /// Gets the release channel of a build: releases are <c>x.y.z.0</c>, beta builds number the fourth part.
    /// </summary>
    /// <param name="version">The plugin version.</param>
    /// <param name="debug">Whether this is a Debug build.</param>
    /// <returns><c>dev</c>, <c>beta</c> or <c>stable</c>.</returns>
    public static string ChannelOf(Version? version, bool debug)
        => debug ? "dev" : version is { Revision: > 0 } ? "beta" : "stable";
}
