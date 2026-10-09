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
/// <c>/web/config.json</c> (<see cref="WebConfigMenuLink"/>). Every other request passes through untouched,
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
        if (config is null || !config.ShowInJellyfinMenu || !WebConfigMenuLink.IsWebConfigRequest(context.Request.Method, context.Request.Path))
        {
            await next().ConfigureAwait(false);
            return;
        }

        // A plain, complete body: no compression, no partial or "not modified" answers.
        var headers = context.Request.Headers;
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
            && (context.Response.ContentType ?? string.Empty).Contains("json", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                body = Encoding.UTF8.GetBytes(Transform(Encoding.UTF8.GetString(body), config));
                // The content now differs from the file, so the file's validators no longer describe it.
                context.Response.Headers.Remove(HeaderNames.ETag);
                context.Response.Headers.Remove(HeaderNames.LastModified);
                context.Response.Headers.CacheControl = "no-cache";
            }
#pragma warning disable CA1031 // Any failure must still serve Jellyfin's own config.json.
            catch (Exception ex)
#pragma warning restore CA1031
            {
                _logger.LogWarning(ex, "Could not add the HAPPY menu link to jellyfin-web's config.json");
                body = buffer.ToArray();
            }
        }

        context.Response.ContentLength = body.Length;
        await original.WriteAsync(body).ConfigureAwait(false);
    }

    private static string Transform(string json, PluginConfiguration config)
        => WebConfigMenuLink.AddMenuLink(
            json,
            string.IsNullOrWhiteSpace(config.JellyfinMenuName) ? "HAPPY" : config.JellyfinMenuName.Trim(),
            string.IsNullOrWhiteSpace(config.JellyfinMenuIcon) ? "vibration" : config.JellyfinMenuIcon.Trim(),
            WebConfigMenuLink.HappyUrl);
}
