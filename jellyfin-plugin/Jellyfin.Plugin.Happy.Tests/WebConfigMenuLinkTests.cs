using System.Linq;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.Happy.Web;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace Jellyfin.Plugin.Happy.Tests;

public class WebConfigMenuLinkTests
{
    private const string DefaultConfig = """{"includeCorsCredentials":false,"multiserver":false,"themes":[],"menuLinks":[],"servers":[],"plugins":["htmlVideoPlayer/plugin"]}""";

    private static JsonArray Links(string json) => (JsonArray)JsonNode.Parse(json)!["menuLinks"]!;

    private static string Add(string json) => WebConfigMenuLink.AddMenuLink(json, "HAPPY", "vibration", WebConfigMenuLink.HappyUrl);

    [Fact]
    public void AddsTheLinkToJellyfinsDefaultConfig()
    {
        var result = JsonNode.Parse(Add(DefaultConfig))!;

        var link = Assert.Single(result["menuLinks"]!.AsArray())!;
        Assert.Equal("HAPPY", link["name"]!.GetValue<string>());
        Assert.Equal("vibration", link["icon"]!.GetValue<string>());
        Assert.Equal("../Happy/Web/", link["url"]!.GetValue<string>());
        // Everything else stays as it was.
        Assert.Equal("htmlVideoPlayer/plugin", result["plugins"]![0]!.GetValue<string>());
        Assert.False(result["multiserver"]!.GetValue<bool>());
    }

    [Fact]
    public void CreatesMenuLinksWhenMissing()
        => Assert.Single(Links(Add("""{"themes":[]}""")));

    [Fact]
    public void KeepsLinksAnAdminAdded()
    {
        var links = Links(Add("""{"menuLinks":[{"name":"Wiki","url":"https://wiki.example.com"}]}"""));

        Assert.Equal(["https://wiki.example.com", "../Happy/Web/"], links.Select(link => link!["url"]!.GetValue<string>()));
    }

    [Fact]
    public void AddsTheLinkOnlyOnce()
    {
        var once = Add(DefaultConfig);

        Assert.Equal(once, Add(once));
    }

    [Fact]
    public void KeepsAnExistingLinkToHappyAndToleratesOddEntries()
    {
        const string Config = """{"menuLinks":[{"name":"Mine","url":"../Happy/Web/"},{"url":5}]}""";

        Assert.Equal(Config, Add(Config));
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("[1,2]")]
    [InlineData("")]
    public void LeavesAnythingButAJsonObjectUnchanged(string input)
        => Assert.Equal(input, Add(input));

    [Theory]
    [InlineData("GET", "/web/config.json", true)]
    [InlineData("GET", "/jellyfin/web/config.json", true)]
    [InlineData("GET", "/Web/Config.json", true)]
    [InlineData("HEAD", "/web/config.json", false)]
    [InlineData("POST", "/web/config.json", false)]
    [InlineData("GET", "/web/index.html", false)]
    [InlineData("GET", "/Happy/Web/config.json", false)]
    public void MatchesOnlyJellyfinWebsConfig(string method, string path, bool expected)
        => Assert.Equal(expected, WebConfigMenuLink.IsWebConfigRequest(method, new PathString(path)));

    [Theory]
    [InlineData("GET", "/web/", true)]
    [InlineData("GET", "/web/index.html", true)]
    [InlineData("GET", "/jellyfin/web/", true)]
    [InlineData("GET", "/Web/Index.html", true)]
    [InlineData("GET", "/web", false)]
    [InlineData("HEAD", "/web/", false)]
    [InlineData("GET", "/web/config.json", false)]
    [InlineData("GET", "/web/main.jellyfin.bundle.js", false)]
    [InlineData("GET", "/Happy/Web/", false)]
    [InlineData("GET", "/Happy/Web/index.html", false)]
    public void MatchesOnlyJellyfinWebsPage(string method, string path, bool expected)
        => Assert.Equal(expected, WebConfigMenuLink.IsWebIndexRequest(method, new PathString(path)));

    [Theory]
    [InlineData("happy", true, "vibration")]
    [InlineData(" Happy ", true, "vibration")]
    [InlineData("", true, "vibration")]
    [InlineData(null, true, "vibration")]
    [InlineData(" favorite ", false, "favorite")]
    public void ResolvesTheIconSetting(string? configured, bool logo, string material)
    {
        Assert.Equal(logo, WebConfigMenuLink.UsesLogo(configured));
        Assert.Equal(material, WebConfigMenuLink.MaterialIcon(configured));
    }

    [Fact]
    public void LinksTheLogoStylesheetOnceAtTheEndOfHead()
    {
        const string page = "<html><head><title>Jellyfin</title></head><body></body></html>";
        var once = WebConfigMenuLink.AddStylesheet(page, WebConfigMenuLink.LogoStylesheetUrl);

        Assert.Equal("<html><head><title>Jellyfin</title><link rel=\"stylesheet\" href=\"../Happy/Web/jellyfin-menu.css\"></head><body></body></html>", once);
        Assert.Equal(once, WebConfigMenuLink.AddStylesheet(once, WebConfigMenuLink.LogoStylesheetUrl));
        Assert.Equal("<p>no head</p>", WebConfigMenuLink.AddStylesheet("<p>no head</p>", WebConfigMenuLink.LogoStylesheetUrl));
    }
}
