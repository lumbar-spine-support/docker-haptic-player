using System;
using System.Linq;
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

    private static readonly Lazy<StaticFileSource> Files = new(() => StaticFileSource.Create("HAPPY_DEV_WEB_ROOT", "web"));

    // Every embedded file changes with the assembly, so one validator covers them all.
    private static readonly EntityTagHeaderValue AssemblyTag =
        new($"\"{typeof(WebController).Assembly.ManifestModule.ModuleVersionId:N}\"");

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

        var file = string.IsNullOrEmpty(path) ? IndexFile : path;
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
            Response.Headers.ETag = AssemblyTag.ToString();
            var ifNoneMatch = Request.GetTypedHeaders().IfNoneMatch;
            if (ifNoneMatch.Any(tag => tag.Compare(AssemblyTag, useStrongComparison: false)))
            {
                return StatusCode(StatusCodes.Status304NotModified);
            }
        }

        return source.Open(file) is { } stream ? File(stream, ContentTypes.Of(file)) : NotFound();
    }
}
