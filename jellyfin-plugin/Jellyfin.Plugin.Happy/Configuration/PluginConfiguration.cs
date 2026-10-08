using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.Happy.Configuration;

/// <summary>
/// Plugin configuration, stored by Jellyfin as XML in the plugin configuration directory.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets or sets the separator between the media stem and script suffixes,
    /// as in <c>&lt;stem&gt;.&lt;type&gt;.funscript</c>. Must match HAPPY's FUNSCRIPT_SUFFIX_SEPARATOR.
    /// </summary>
    public string FunscriptSeparator { get; set; } = ".";
}
