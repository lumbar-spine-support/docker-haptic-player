using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.Happy.Configuration;

/// <summary>
/// The HAPPY client's settings as returned by <c>GET /Happy/Config</c>. Property names are camelCase on
/// purpose: the shape is <c>ClientSettings</c> in <c>src/shared/types.ts</c>, not a Jellyfin DTO.
/// </summary>
public sealed record ClientSettings
{
    /// <summary>
    /// Interpolation methods HAPPY knows (<c>INTERPOLATION_METHODS</c> in <c>src/shared/interpolation.ts</c>).
    /// </summary>
    public static readonly IReadOnlyList<string> InterpolationMethods = ["none", "linear", "pchip"];

    /// <summary>
    /// Chapter sources HAPPY knows (<c>CHAPTER_SOURCES</c> in <c>src/shared/types.ts</c>).
    /// </summary>
    public static readonly IReadOnlyList<string> ChapterSources = ["embedded", "funscript"];

    /// <summary>
    /// Themes HAPPY ships (<c>THEMES</c> in <c>src/shared/types.ts</c>, <c>public/css/themes/</c>).
    /// </summary>
    public static readonly IReadOnlyList<string> Themes = ["oled", "jellyfin"];

    private const string DefaultInterpolationMethod = "pchip";

    private const string DefaultTheme = "oled";

    /// <summary>Gets the seek interval in seconds.</summary>
    [JsonPropertyName("videoSeekInterval")]
    public int VideoSeekInterval { get; init; }

    /// <summary>Gets a value indicating whether content is blurred by default.</summary>
    [JsonPropertyName("blurContent")]
    public bool BlurContent { get; init; }

    /// <summary>Gets the Intiface update rate in Hz.</summary>
    [JsonPropertyName("hapticFrequency")]
    public int HapticFrequency { get; init; }

    /// <summary>Gets the default haptic delay in milliseconds.</summary>
    [JsonPropertyName("hapticDelay")]
    public int HapticDelay { get; init; }

    /// <summary>Gets the absolute bound of the delay sliders in milliseconds.</summary>
    [JsonPropertyName("hapticDelayLimit")]
    public int HapticDelayLimit { get; init; }

    /// <summary>Gets a value indicating whether DG-Lab support is shown.</summary>
    [JsonPropertyName("dglabEnabled")]
    public bool DglabEnabled { get; init; }

    /// <summary>Gets a value indicating whether the DG-Lab sandbox is shown.</summary>
    [JsonPropertyName("dglabSandboxEnabled")]
    public bool DglabSandboxEnabled { get; init; }

    /// <summary>Gets the DG-Lab relay address.</summary>
    [JsonPropertyName("dglabRelayUrl")]
    public string DglabRelayUrl { get; init; } = string.Empty;

    /// <summary>Gets a value indicating whether HAPPY reconnects to Intiface on load.</summary>
    [JsonPropertyName("autoReconnectIntiface")]
    public bool AutoReconnectIntiface { get; init; }

    /// <summary>Gets a value indicating whether HAPPY reconnects to the DG-Lab relay on load.</summary>
    [JsonPropertyName("autoReconnectDglab")]
    public bool AutoReconnectDglab { get; init; }

    /// <summary>Gets a value indicating whether HAPPY logs debug output.</summary>
    [JsonPropertyName("debugLogging")]
    public bool DebugLogging { get; init; }

    /// <summary>Gets the funscript interpolation method.</summary>
    [JsonPropertyName("funscriptInterpolationMethod")]
    public string FunscriptInterpolationMethod { get; init; } = DefaultInterpolationMethod;

    /// <summary>Gets a value indicating whether the timeline is coloured by speed.</summary>
    [JsonPropertyName("funscriptColorGradient")]
    public bool FunscriptColorGradient { get; init; }

    /// <summary>Gets a value indicating whether card artwork is cropped to a square.</summary>
    [JsonPropertyName("cardViewForceSquareArtwork")]
    public bool CardViewForceSquareArtwork { get; init; }

    /// <summary>Gets a value indicating whether portrait artwork takes up two rows.</summary>
    [JsonPropertyName("cardViewLargePortraitArtwork")]
    public bool CardViewLargePortraitArtwork { get; init; }

    /// <summary>Gets the theme, one of <see cref="Themes"/>.</summary>
    [JsonPropertyName("theme")]
    public string Theme { get; init; } = DefaultTheme;

    /// <summary>Gets the Jellyfin address; always empty, since the page served by the plugin knows it.</summary>
    [JsonPropertyName("jellyfinUrl")]
    public string JellyfinUrl { get; init; } = string.Empty;

    /// <summary>Gets the funscript suffixes.</summary>
    [JsonPropertyName("funscriptSuffixes")]
    public required FunscriptSuffixes FunscriptSuffixes { get; init; }

    /// <summary>Gets the ids (32 hex digits) of the libraries HAPPY uses; empty means all libraries.</summary>
    [JsonPropertyName("libraryIds")]
    public IReadOnlyList<string> LibraryIds { get; init; } = [];

    /// <summary>Gets the chapter sources in order of precedence.</summary>
    [JsonPropertyName("chapterSourcePriority")]
    public required IReadOnlyList<string> ChapterSourcePriority { get; init; }

    /// <summary>
    /// Builds the client settings from the plugin configuration, repairing values the client could
    /// not use (unknown interpolation methods, themes and chapter sources, empty suffixes, negative ranges).
    /// </summary>
    /// <param name="config">The plugin configuration.</param>
    /// <returns>The client settings.</returns>
    public static ClientSettings From(PluginConfiguration config)
    {
        ArgumentNullException.ThrowIfNull(config);
        var method = config.FunscriptInterpolationMethod?.Trim().ToLowerInvariant() ?? string.Empty;
        return new ClientSettings
        {
            VideoSeekInterval = Math.Max(1, config.VideoSeekInterval),
            BlurContent = config.BlurContent,
            HapticFrequency = Math.Max(1, config.HapticFrequency),
            HapticDelay = config.HapticDelay,
            HapticDelayLimit = Math.Abs(config.HapticDelayLimit),
            DglabEnabled = config.DglabEnabled,
            DglabSandboxEnabled = config.DglabEnabled && config.DglabSandboxEnabled,
            DglabRelayUrl = config.DglabRelayUrl?.Trim() ?? string.Empty,
            AutoReconnectIntiface = config.AutoReconnectIntiface,
            AutoReconnectDglab = config.AutoReconnectDglab,
            DebugLogging = config.DebugLogging,
            FunscriptInterpolationMethod = InterpolationMethods.Contains(method) ? method : DefaultInterpolationMethod,
            FunscriptColorGradient = config.FunscriptColorGradient,
            CardViewForceSquareArtwork = config.CardViewForceSquareArtwork,
            CardViewLargePortraitArtwork = config.CardViewLargePortraitArtwork,
            Theme = ParseTheme(config.Theme),
            FunscriptSuffixes = new FunscriptSuffixes
            {
                Separator = OrDefault(config.FunscriptSeparator, "."),
                Stroker = OrDefault(config.FunscriptSuffixStroker, "stroker"),
                Buttplug = OrDefault(config.FunscriptSuffixButtplug, "buttplug"),
                Vibrator = OrDefault(config.FunscriptSuffixVibrator, "vibrator"),
                Estim = OrDefault(config.FunscriptSuffixEstim, "estim"),
                Machine = OrDefault(config.FunscriptSuffixMachine, "machine"),
            },
            ChapterSourcePriority = ParseChapterSources(config.ChapterSourcePriority),
            LibraryIds = ParseLibraryIds(config.LibraryIds).Select(id => id.ToString("N")).ToArray(),
        };
    }

    /// <summary>
    /// Parses a comma-separated chapter source list, dropping unknown and duplicate entries.
    /// </summary>
    /// <param name="value">The configured list.</param>
    /// <returns>Known sources in the configured order.</returns>
    internal static IReadOnlyList<string> ParseChapterSources(string? value)
        => (value ?? string.Empty)
            .Split([',', ' ', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(source => source.ToLowerInvariant())
            .Where(source => ChapterSources.Contains(source))
            .Distinct()
            .ToArray();

    /// <summary>
    /// Parses the configured library ids, dropping invalid and duplicate entries.
    /// </summary>
    /// <param name="value">The configured ids.</param>
    /// <returns>Valid ids in the configured order; empty means all libraries.</returns>
    internal static IReadOnlyList<Guid> ParseLibraryIds(IEnumerable<string>? value)
        => (value ?? [])
            .Select(id => Guid.TryParse(id?.Trim(), out var guid) ? guid : Guid.Empty)
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();

    /// <summary>
    /// Normalizes a configured theme name, falling back to the default for unknown ones.
    /// </summary>
    /// <param name="value">The configured theme.</param>
    /// <returns>One of <see cref="Themes"/>.</returns>
    internal static string ParseTheme(string? value)
    {
        var theme = value?.Trim().ToLowerInvariant() ?? string.Empty;
        return Themes.Contains(theme) ? theme : DefaultTheme;
    }

    private static string OrDefault(string? value, string fallback)
        => string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
}
