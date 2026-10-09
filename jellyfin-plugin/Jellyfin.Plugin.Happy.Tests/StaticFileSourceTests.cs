using System;
using System.IO;
using System.Linq;
using Jellyfin.Plugin.Happy.Web;
using Xunit;

namespace Jellyfin.Plugin.Happy.Tests;

public sealed class StaticFileSourceTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("happy-static-").FullName;

    public StaticFileSourceTests()
    {
        Directory.CreateDirectory(Path.Combine(_root, "js"));
        File.WriteAllText(Path.Combine(_root, "index.html"), "<html>");
        File.WriteAllText(Path.Combine(_root, "js", "app.js"), "app");
        File.WriteAllText(Path.Combine(_root, ".secret"), "no");
    }

    public void Dispose() => Directory.Delete(_root, true);

    [Theory]
    [InlineData("index.html")]
    [InlineData("js/app.js")]
    [InlineData("vendor/bootstrap-icons/fonts/bootstrap-icons.woff2")]
    [InlineData("vendor/@videojs/x.js")]
    public void AllowsOrdinaryPaths(string path) => Assert.True(StaticFileSource.IsSafePath(path));

    [Theory]
    [InlineData("")]
    [InlineData("../etc/passwd")]
    [InlineData("js/../../x")]
    [InlineData(".secret")]
    [InlineData("js/.hidden")]
    [InlineData("js//app.js")]
    [InlineData("/etc/passwd")]
    [InlineData("js\\app.js")]
    public void RejectsTraversalDotfilesAndOddSeparators(string path) => Assert.False(StaticFileSource.IsSafePath(path));

    [Fact]
    public void ServesFilesFromADirectory()
    {
        var source = StaticFileSource.FromDirectory(_root);
        using (var stream = source.Open("js/app.js"))
        {
            Assert.NotNull(stream);
        }

        Assert.Null(source.Open("missing.js"));
        Assert.Null(source.Open(".secret"));
        Assert.Null(source.Open("../" + Path.GetFileName(_root) + "/index.html"));
        Assert.Contains("index.html", source.ListRoot());
        Assert.DoesNotContain("app.js", source.ListRoot());
    }

    [Fact]
    public void EmbedsTheBuiltClientWhenThereIsOne()
    {
        // public/ is only there after `npm run build:client`; CI builds it before testing the plugin.
        var publicDir = Path.Combine(AppContext.BaseDirectory, "../../../../../public");
        if (!File.Exists(Path.Combine(publicDir, "js", "app.js")))
        {
            return;
        }

        var source = StaticFileSource.FromAssembly(typeof(StaticFileSource).Assembly, "web");
        foreach (var file in new[] { "index.html", "manifest.webmanifest", "js/app.js", "css/app.css", "vendor/bootstrap/bootstrap.bundle.min.js", "vendor/bootstrap-icons/bootstrap-icons.min.css" })
        {
            using var stream = source.Open(file);
            Assert.True(stream is not null, file);
        }

        Assert.Null(source.Open("js/app.js.map"));
    }

    [Fact]
    public void ServesTheEmbeddedDocs()
    {
        var source = StaticFileSource.FromAssembly(typeof(StaticFileSource).Assembly, "docs");
        var pages = source.ListRoot().ToList();

        Assert.Contains("index.md", pages);
        Assert.DoesNotContain(pages, name => name.StartsWith("developer", StringComparison.Ordinal));
        using var page = source.Open("index.md");
        Assert.NotNull(page);
    }
}
