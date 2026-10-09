using System;

namespace Jellyfin.Plugin.Happy.Funscripts;

/// <summary>
/// A media item considered for funscript matching.
/// </summary>
/// <param name="Id">Jellyfin item id.</param>
/// <param name="Path">Absolute path of the media file.</param>
internal sealed record MediaFile(Guid Id, string Path);
