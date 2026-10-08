using System;
using Jellyfin.Plugin.Happy.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.Happy;

/// <summary>
/// HAPPY companion plugin: exposes funscripts next to library media to the HAPPY player.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>
{
    /// <summary>
    /// Initializes a new instance of the <see cref="Plugin"/> class.
    /// </summary>
    /// <param name="applicationPaths">Instance of the <see cref="IApplicationPaths"/> interface.</param>
    /// <param name="xmlSerializer">Instance of the <see cref="IXmlSerializer"/> interface.</param>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    /// <inheritdoc />
    public override string Name => "HAPPY";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("98652011-fd1c-4b30-8359-fcae3b45ed37");

    /// <inheritdoc />
    public override string Description => "Funscript companion API for the HAPPY haptic player.";

    /// <summary>
    /// Gets the current plugin instance.
    /// </summary>
    public static Plugin? Instance { get; private set; }
}
