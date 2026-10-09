using Jellyfin.Plugin.Happy.Api;
using Jellyfin.Plugin.Happy.Configuration;
using Microsoft.Net.Http.Headers;
using Xunit;

namespace Jellyfin.Plugin.Happy.Tests;

public class WebControllerTests
{
    private static readonly EntityTagHeaderValue Assembly = new("\"0123abcd\"");

    [Fact]
    public void EveryThemeHasAStylesheetPath()
    {
        foreach (var theme in ClientSettings.Themes)
        {
            Assert.Equal($"css/themes/{theme}.css", WebController.ThemePath(theme));
        }
    }

    [Fact]
    public void ThemeTagChangesWithTheTheme()
    {
        var oled = WebController.ThemeTag(Assembly, "oled");
        var jellyfin = WebController.ThemeTag(Assembly, "jellyfin");

        Assert.Equal("\"0123abcd-oled\"", oled.ToString());
        Assert.False(oled.Compare(jellyfin, useStrongComparison: false));
        Assert.False(oled.Compare(Assembly, useStrongComparison: false));
    }
}
