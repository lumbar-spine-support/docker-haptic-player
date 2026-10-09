using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.Happy.Configuration;

/// <summary>
/// Plugin configuration, stored by Jellyfin as XML in the plugin configuration directory and edited on
/// the plugin's dashboard page. Except for the funscript separator, every value is a server-side default
/// for the HAPPY client (<c>GET /Happy/Config</c>); several of them users can still change in HAPPY.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets or sets the seek interval in seconds when double-tapping or double-clicking the video.
    /// </summary>
    public int VideoSeekInterval { get; set; } = 10;

    /// <summary>
    /// Gets or sets a value indicating whether images and videos are blurred by default.
    /// </summary>
    public bool BlurContent { get; set; }

    /// <summary>
    /// Gets or sets the default Intiface update rate in Hz.
    /// </summary>
    public int HapticFrequency { get; set; } = 30;

    /// <summary>
    /// Gets or sets the default haptic delay in milliseconds.
    /// </summary>
    public int HapticDelay { get; set; }

    /// <summary>
    /// Gets or sets the absolute bound of the haptic delay sliders in milliseconds.
    /// </summary>
    public int HapticDelayLimit { get; set; } = 500;

    /// <summary>
    /// Gets or sets a value indicating whether the DG-Lab Coyote support is shown.
    /// </summary>
    public bool DglabEnabled { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the DG-Lab waveform sandbox is shown (only with DG-Lab enabled).
    /// </summary>
    public bool DglabSandboxEnabled { get; set; } = true;

    /// <summary>
    /// Gets or sets the address of the DG-Lab relay as browsers and phones reach it, e.g. <c>wss://relay.example.com</c>.
    /// </summary>
    public string DglabRelayUrl { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether HAPPY reconnects to Intiface on page load.
    /// </summary>
    public bool AutoReconnectIntiface { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether HAPPY reconnects to the DG-Lab relay on page load.
    /// </summary>
    public bool AutoReconnectDglab { get; set; } = true;

    /// <summary>
    /// Gets or sets how positions between funscript points are computed: none, linear or pchip.
    /// </summary>
    public string FunscriptInterpolationMethod { get; set; } = "pchip";

    /// <summary>
    /// Gets or sets a value indicating whether the timeline graph is coloured by movement speed by default.
    /// </summary>
    public bool FunscriptColorGradient { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether card artwork is cropped to a square.
    /// </summary>
    public bool CardViewForceSquareArtwork { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether portrait artwork takes up two rows.
    /// </summary>
    public bool CardViewLargePortraitArtwork { get; set; }

    /// <summary>
    /// Gets or sets the look of HAPPY: oled (pure black) or jellyfin (Jellyfin's dark theme).
    /// </summary>
    public string Theme { get; set; } = "oled";

    /// <summary>
    /// Gets or sets the separator between the media stem and script suffixes, as in
    /// <c>&lt;stem&gt;.&lt;type&gt;.funscript</c>. Used for matching here and for parsing in HAPPY.
    /// </summary>
    public string FunscriptSeparator { get; set; } = ".";

    /// <summary>
    /// Gets or sets the suffix of stroker scripts.
    /// </summary>
    public string FunscriptSuffixStroker { get; set; } = "stroker";

    /// <summary>
    /// Gets or sets the suffix of buttplug scripts.
    /// </summary>
    public string FunscriptSuffixButtplug { get; set; } = "buttplug";

    /// <summary>
    /// Gets or sets the suffix of vibrator scripts.
    /// </summary>
    public string FunscriptSuffixVibrator { get; set; } = "vibrator";

    /// <summary>
    /// Gets or sets the suffix of e-stim scripts.
    /// </summary>
    public string FunscriptSuffixEstim { get; set; } = "estim";

    /// <summary>
    /// Gets or sets the suffix of machine scripts.
    /// </summary>
    public string FunscriptSuffixMachine { get; set; } = "machine";

    /// <summary>
    /// Gets or sets the chapter sources in order of precedence, comma-separated (embedded, funscript).
    /// Empty disables chapters.
    /// </summary>
    public string ChapterSourcePriority { get; set; } = "embedded,funscript";

    /// <summary>
    /// Gets or sets a value indicating whether HAPPY logs debug output to the browser console.
    /// </summary>
    public bool DebugLogging { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether Jellyfin's web client lists HAPPY in its menu
    /// (a <c>menuLinks</c> entry added to <c>/web/config.json</c>).
    /// </summary>
    public bool ShowInJellyfinMenu { get; set; } = true;

    /// <summary>
    /// Gets or sets the text of HAPPY's entry in Jellyfin's menu.
    /// </summary>
    public string JellyfinMenuName { get; set; } = "HAPPY";

    /// <summary>
    /// Gets or sets the Material icon name of HAPPY's entry in Jellyfin's menu.
    /// </summary>
    public string JellyfinMenuIcon { get; set; } = "vibration";
}
