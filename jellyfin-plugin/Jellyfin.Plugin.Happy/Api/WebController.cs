using System;
using System.Linq;
using Jellyfin.Plugin.Happy.Configuration;
using Jellyfin.Plugin.Happy.Web;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.Happy.Api;

/// <summary>
/// The HAPPY web app at <c>/Happy/Web/</c>: the built client (<c>public/</c>) embedded in the DLL. Public,
/// because the page itself shows the Jellyfin sign-in; everything behind it needs a token.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("Happy/Web")]
public class WebController : ControllerBase
{
    private const string IndexFile = "index.html";

    private const string ThemeFile = "theme.css";

    private static readonly Lazy<StaticFileSource> Files = new(() => StaticFileSource.Create("HAPPY_DEV_WEB_ROOT", "web"));

    // Every embedded file changes with the assembly, so one validator covers them all.
    private static readonly EntityTagHeaderValue AssemblyTag =
        new($"\"{typeof(WebController).Assembly.ManifestModule.ModuleVersionId:N}\"");

    /// <summary>
    /// Serves the stylesheet of the theme chosen in the plugin settings (<c>css/themes/&lt;theme&gt;.css</c>).
    /// index.html links it after the app's stylesheet, so the page has the right colours before any script
    /// runs and before sign-in.
    /// </summary>
    /// <returns>The theme's stylesheet.</returns>
    [HttpGet(ThemeFile)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status304NotModified)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult GetTheme()
    {
        var theme = ClientSettings.ParseTheme(Plugin.Instance?.Configuration.Theme);
        return Serve(ThemePath(theme), ThemeTag(AssemblyTag, theme));
    }

    /// <summary>
    /// Serves a file of the app, or the app itself for the root.
    /// </summary>
    /// <param name="path">Path below <c>/Happy/Web/</c>.</param>
    /// <returns>The file.</returns>
    [HttpGet("{**path}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status301MovedPermanently)]
    [ProducesResponseType(StatusCodes.Status304NotModified)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult GetFile([FromRoute] string? path)
    {
        // Relative asset URLs in index.html resolve against the directory, so /Happy/Web needs its slash.
        if (string.IsNullOrEmpty(path) && !(Request.Path.Value ?? string.Empty).EndsWith('/'))
        {
            return RedirectPermanent($"{Request.PathBase}{Request.Path}/{Request.QueryString}");
        }

        return Serve(string.IsNullOrEmpty(path) ? IndexFile : path, AssemblyTag);
    }

    /// <summary>
    /// Gets the path of a theme's stylesheet below the web root.
    /// </summary>
    /// <param name="theme">A theme from <see cref="ClientSettings.Themes"/>.</param>
    /// <returns>The path.</returns>
    internal static string ThemePath(string theme) => $"css/themes/{theme}.css";

    /// <summary>
    /// Gets the validator of <c>theme.css</c>: it changes with the assembly and with the chosen theme.
    /// </summary>
    /// <param name="assemblyTag">The validator of the embedded files.</param>
    /// <param name="theme">The chosen theme.</param>
    /// <returns>The validator.</returns>
    internal static EntityTagHeaderValue ThemeTag(EntityTagHeaderValue assemblyTag, string theme)
        => new($"\"{assemblyTag.Tag.ToString().Trim('"')}-{theme}\"");

    private ActionResult Serve(string file, EntityTagHeaderValue tag)
    {
        var source = Files.Value;
        if (source.IsDirectory)
        {
            // Local dev Jellyfin: files change under its feet, so never cache.
            Response.Headers.CacheControl = "no-store";
        }
        else
        {
            // Not fingerprinted, so always revalidate; a plugin update changes the tag.
            Response.Headers.CacheControl = "no-cache";
            Response.Headers.ETag = tag.ToString();
            var ifNoneMatch = Request.GetTypedHeaders().IfNoneMatch;
            if (ifNoneMatch.Any(other => other.Compare(tag, useStrongComparison: false)))
            {
                return StatusCode(StatusCodes.Status304NotModified);
            }
        }

        return source.Open(file) is { } stream ? File(stream, ContentTypes.Of(file)) : NotFound();
    }
}
