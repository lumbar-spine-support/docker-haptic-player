using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Jellyfin.Plugin.Happy.Configuration;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.Happy.Web;

/// <summary>
/// Puts a middleware in front of Jellyfin's pipeline that adds the HAPPY link to jellyfin-web's
/// <c>/web/config.json</c> and, for HAPPY's logo as its icon, links the logo stylesheet into jellyfin-web's
/// <c>index.html</c> (<see cref="WebConfigMenuLink"/>). Every other request passes through untouched,
/// and any failure serves the original response.
/// </summary>
public sealed class WebConfigStartupFilter : IStartupFilter
{
    private readonly ILogger<WebConfigStartupFilter> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="WebConfigStartupFilter"/> class.
    /// </summary>
    /// <param name="logger">Instance of the <see cref="ILogger{WebConfigStartupFilter}"/> interface.</param>
    public WebConfigStartupFilter(ILogger<WebConfigStartupFilter> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
        => app =>
        {
            app.Use(RewriteWebConfig);
            next(app);
        };

    private async Task RewriteWebConfig(HttpContext context, Func<Task> next)
    {
        var config = Plugin.Instance?.Configuration;
        var request = context.Request;
        Func<string, string>? transform = null;
        var contentType = string.Empty;
        if (config is { ShowInJellyfinMenu: true })
        {
            if (WebConfigMenuLink.IsWebConfigRequest(request.Method, request.Path))
            {
                transform = json => AddMenuLink(json, config);
                contentType = "json";
            }
            else if (WebConfigMenuLink.UsesLogo(config.JellyfinMenuIcon) && WebConfigMenuLink.IsWebIndexRequest(request.Method, request.Path))
            {
                transform = html => WebConfigMenuLink.AddStylesheet(html, WebConfigMenuLink.LogoStylesheetUrl);
                contentType = "html";
            }
        }

        if (transform is null)
        {
            await next().ConfigureAwait(false);
            return;
        }

        // A plain, complete body: no compression, no partial or "not modified" answers.
        var headers = request.Headers;
        headers.Remove(HeaderNames.AcceptEncoding);
        headers.Remove(HeaderNames.Range);
        headers.Remove(HeaderNames.IfRange);
        headers.Remove(HeaderNames.IfNoneMatch);
        headers.Remove(HeaderNames.IfModifiedSince);

        var original = context.Response.Body;
        using var buffer = new MemoryStream();
        context.Response.Body = buffer;
        try
        {
            await next().ConfigureAwait(false);
        }
        finally
        {
            context.Response.Body = original;
        }

        var body = buffer.ToArray();
        if (context.Response.StatusCode == StatusCodes.Status200OK
            && (context.Response.ContentType ?? string.Empty).Contains(contentType, StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                body = Encoding.UTF8.GetBytes(transform(Encoding.UTF8.GetString(body)));
                // The content now differs from the file, so the file's validators no longer describe it.
                context.Response.Headers.Remove(HeaderNames.ETag);
                context.Response.Headers.Remove(HeaderNames.LastModified);
                context.Response.Headers.CacheControl = "no-cache";
            }
#pragma warning disable CA1031 // Any failure must still serve jellyfin-web's own file.
            catch (Exception ex)
#pragma warning restore CA1031
            {
                _logger.LogWarning(ex, "Could not add HAPPY to jellyfin-web's {File}", request.Path);
                body = buffer.ToArray();
            }
        }

        context.Response.ContentLength = body.Length;
        await original.WriteAsync(body).ConfigureAwait(false);
    }

    private static string AddMenuLink(string json, PluginConfiguration config)
        => WebConfigMenuLink.AddMenuLink(
            json,
            string.IsNullOrWhiteSpace(config.JellyfinMenuName) ? "HAPPY" : config.JellyfinMenuName.Trim(),
            WebConfigMenuLink.MaterialIcon(config.JellyfinMenuIcon),
            WebConfigMenuLink.HappyUrl);
}
