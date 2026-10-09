using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.Happy.Configuration;

/// <summary>
/// Funscript name parts as HAPPY parses them (<c>FunscriptSuffixes</c> in <c>src/shared/funscriptNames.ts</c>).
/// </summary>
public sealed record FunscriptSuffixes
{
    /// <summary>Gets the separator between stem and suffixes.</summary>
    [JsonPropertyName("separator")]
    public required string Separator { get; init; }

    /// <summary>Gets the stroker suffix.</summary>
    [JsonPropertyName("stroker")]
    public required string Stroker { get; init; }

    /// <summary>Gets the buttplug suffix.</summary>
    [JsonPropertyName("buttplug")]
    public required string Buttplug { get; init; }

    /// <summary>Gets the vibrator suffix.</summary>
    [JsonPropertyName("vibrator")]
    public required string Vibrator { get; init; }

    /// <summary>Gets the e-stim suffix.</summary>
    [JsonPropertyName("estim")]
    public required string Estim { get; init; }

    /// <summary>Gets the machine suffix.</summary>
    [JsonPropertyName("machine")]
    public required string Machine { get; init; }
}
