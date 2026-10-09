using System.Text.Json;
using Jellyfin.Plugin.Happy.Configuration;
using Xunit;

namespace Jellyfin.Plugin.Happy.Tests;

public class ClientSettingsTests
{
    [Fact]
    public void DefaultsMatchTheHappyClientDefaults()
    {
        var settings = ClientSettings.From(new PluginConfiguration());

        Assert.Equal(10, settings.VideoSeekInterval);
        Assert.Equal(30, settings.HapticFrequency);
        Assert.Equal(500, settings.HapticDelayLimit);
        Assert.False(settings.DglabEnabled);
        Assert.False(settings.DglabSandboxEnabled); // only with DG-Lab enabled
        Assert.Equal("pchip", settings.FunscriptInterpolationMethod);
        Assert.Equal(["embedded", "funscript"], settings.ChapterSourcePriority);
        Assert.Equal(".", settings.FunscriptSuffixes.Separator);
        Assert.Equal("stroker", settings.FunscriptSuffixes.Stroker);
        Assert.Equal(string.Empty, settings.JellyfinUrl);
    }

    [Fact]
    public void SerializesToTheCamelCaseShapeOfTheClient()
    {
        var json = JsonSerializer.Serialize(ClientSettings.From(new PluginConfiguration { DglabEnabled = true }));
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.True(root.GetProperty("dglabEnabled").GetBoolean());
        Assert.True(root.GetProperty("dglabSandboxEnabled").GetBoolean());
        Assert.Equal("", root.GetProperty("dglabRelayUrl").GetString());
        Assert.Equal(".", root.GetProperty("funscriptSuffixes").GetProperty("separator").GetString());
        Assert.Equal(JsonValueKind.Array, root.GetProperty("chapterSourcePriority").ValueKind);
        Assert.False(root.TryGetProperty("DglabEnabled", out _));
    }

    [Fact]
    public void RepairsInvalidValues()
    {
        var settings = ClientSettings.From(new PluginConfiguration
        {
            HapticDelayLimit = -300,
            VideoSeekInterval = 0,
            FunscriptInterpolationMethod = " Linear ",
            FunscriptSeparator = "",
            FunscriptSuffixEstim = "  ",
            DglabRelayUrl = " wss://relay.example.com ",
        });

        Assert.Equal(300, settings.HapticDelayLimit);
        Assert.Equal(1, settings.VideoSeekInterval);
        Assert.Equal("linear", settings.FunscriptInterpolationMethod);
        Assert.Equal(".", settings.FunscriptSuffixes.Separator);
        Assert.Equal("estim", settings.FunscriptSuffixes.Estim);
        Assert.Equal("wss://relay.example.com", settings.DglabRelayUrl);
        Assert.Equal("pchip", ClientSettings.From(new PluginConfiguration { FunscriptInterpolationMethod = "cubic" }).FunscriptInterpolationMethod);
    }

    [Theory]
    [InlineData("embedded,funscript", new[] { "embedded", "funscript" })]
    [InlineData("Funscript, embedded", new[] { "funscript", "embedded" })]
    [InlineData("funscript,funscript,bogus", new[] { "funscript" })]
    [InlineData("", new string[0])]
    public void ParsesChapterSources(string value, string[] expected)
        => Assert.Equal(expected, ClientSettings.ParseChapterSources(value));

    [Theory]
    [InlineData(null, "oled")]
    [InlineData("", "oled")]
    [InlineData(" Jellyfin ", "jellyfin")]
    [InlineData("oled", "oled")]
    [InlineData("../app", "oled")]
    public void ParsesThemes(string? value, string expected)
    {
        Assert.Equal(expected, ClientSettings.ParseTheme(value));
        Assert.Equal(expected, ClientSettings.From(new PluginConfiguration { Theme = value! }).Theme);
    }

    [Fact]
    public void SerializesTheOledThemeByDefault()
    {
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(ClientSettings.From(new PluginConfiguration())));
        Assert.Equal("oled", doc.RootElement.GetProperty("theme").GetString());
    }

    [Fact]
    public void UsesAllLibrariesByDefault()
    {
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(ClientSettings.From(new PluginConfiguration())));
        Assert.Equal(0, doc.RootElement.GetProperty("libraryIds").GetArrayLength());
    }

    [Fact]
    public void NormalizesLibraryIdsToJellyfinItemIds()
    {
        var settings = ClientSettings.From(new PluginConfiguration
        {
            LibraryIds =
            [
                " 6F2C1B5E-0F4D-4C77-9A4B-2B1E1A9F3D10 ",
                "6f2c1b5e0f4d4c779a4b2b1e1a9f3d10",
                "not-a-guid",
                "",
                "00000000-0000-0000-0000-000000000000",
                "a1b2c3d4e5f60718293a4b5c6d7e8f90",
            ],
        });

        Assert.Equal(["6f2c1b5e0f4d4c779a4b2b1e1a9f3d10", "a1b2c3d4e5f60718293a4b5c6d7e8f90"], settings.LibraryIds);
    }
}
