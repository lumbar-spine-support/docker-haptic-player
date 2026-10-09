using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Mime;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.Happy.Web;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Happy.Api;

/// <summary>
/// HAPPY's user documentation (<c>docs/*.md</c> and their images), shown in the app. Public like the docs
/// on GitHub, and because images are loaded by <c>&lt;img&gt;</c> tags, which carry no token.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("Happy/Docs")]
public partial class DocsController : ControllerBase
{
    private static readonly HashSet<string> AssetExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
    };

    private static readonly Lazy<StaticFileSource> Files = new(() => StaticFileSource.Create("HAPPY_DEV_DOCS_ROOT", "docs"));

    /// <summary>
    /// Lists the documentation pages.
    /// </summary>
    /// <returns>Page names without extension.</returns>
    [HttpGet]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult<DocsIndex> GetPages()
        => new DocsIndex(Files.Value.ListRoot()
            .Where(name => name.EndsWith(".md", StringComparison.Ordinal))
            .Select(name => name[..^3])
            .Where(name => PageName().IsMatch(name))
            .Order(StringComparer.Ordinal)
            .ToArray());

    /// <summary>
    /// Gets one documentation page as Markdown.
    /// </summary>
    /// <param name="page">Page name without extension.</param>
    /// <returns>The Markdown source.</returns>
    [HttpGet("{page}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult GetPage([FromRoute] string page)
        => PageName().IsMatch(page) && Files.Value.Open(page + ".md") is { } stream
            ? File(stream, ContentTypes.Of(".md"))
            : NotFound();

    /// <summary>
    /// Gets an image referenced by the documentation.
    /// </summary>
    /// <param name="path">Path relative to the docs folder.</param>
    /// <returns>The image.</returns>
    [HttpGet("assets/{**path}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult GetAsset([FromRoute] string path)
        => AssetExtensions.Contains(Path.GetExtension(path)) && Files.Value.Open(path) is { } stream
            ? File(stream, ContentTypes.Of(path))
            : NotFound();

    [GeneratedRegex("^[a-z0-9-]+$")]
    private static partial Regex PageName();
}
