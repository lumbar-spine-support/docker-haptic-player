using System;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Jellyfin.Plugin.Happy.Web;

/// <summary>
/// Adds HAPPY to jellyfin-web's menu through its own <c>menuLinks</c> setting in <c>/web/config.json</c>.
/// jellyfin-web renders those links for every user (side drawer and the top bar's view list), so no
/// script is injected into Jellyfin's web client: HAPPY changes data the client already understands.
/// Only for HAPPY's logo as the icon, a stylesheet (<c>public/jellyfin-menu.css</c>) is linked into
/// jellyfin-web's <c>index.html</c>, since <c>menuLinks</c> takes nothing but Material icon names.
/// </summary>
public static class WebConfigMenuLink
{
    /// <summary>
    /// Link target, relative to <c>/web/</c>, so a Jellyfin base URL (<c>/jellyfin/web/</c>) is kept.
    /// </summary>
    public const string HappyUrl = "../Happy/Web/";

    /// <summary>
    /// Icon setting that shows HAPPY's logo instead of a Material icon.
    /// </summary>
    public const string LogoIcon = "happy";

    /// <summary>
    /// Stylesheet that draws the logo, relative to <c>/web/</c> like <see cref="HappyUrl"/>.
    /// </summary>
    public const string LogoStylesheetUrl = "../Happy/Web/jellyfin-menu.css";

    // Sent as the link's Material icon when the logo is used, so jellyfin-web shows it if the stylesheet fails.
    private const string LogoFallbackIcon = "vibration";

    private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

    /// <summary>
    /// Checks whether a request is jellyfin-web's <c>config.json</c>, with or without a base URL.
    /// </summary>
    /// <param name="method">The HTTP method.</param>
    /// <param name="path">The request path.</param>
    /// <returns>Whether the response should get the HAPPY menu link.</returns>
    public static bool IsWebConfigRequest(string method, PathString path)
    {
        var value = path.Value ?? string.Empty;
        // Routes are case-insensitive, so /Happy/Web/… would match too; it is HAPPY's, not jellyfin-web's.
        return HttpMethods.IsGet(method)
               && value.EndsWith("/web/config.json", StringComparison.OrdinalIgnoreCase)
               && !value.EndsWith("/happy/web/config.json", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Checks whether a request is jellyfin-web's page (<c>/web/</c> or <c>/web/index.html</c>), with or
    /// without a base URL.
    /// </summary>
    /// <param name="method">The HTTP method.</param>
    /// <param name="path">The request path.</param>
    /// <returns>Whether the response should get the logo stylesheet.</returns>
    public static bool IsWebIndexRequest(string method, PathString path)
    {
        var value = path.Value ?? string.Empty;
        return HttpMethods.IsGet(method)
               && (value.EndsWith("/web/", StringComparison.OrdinalIgnoreCase)
                   || value.EndsWith("/web/index.html", StringComparison.OrdinalIgnoreCase))
               && !value.EndsWith("/happy/web/", StringComparison.OrdinalIgnoreCase)
               && !value.EndsWith("/happy/web/index.html", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Gets the Material icon name for <c>menuLinks</c> from the icon setting.
    /// </summary>
    /// <param name="configured">The configured icon: a Material icon name or <see cref="LogoIcon"/>.</param>
    /// <returns>The icon name for <c>config.json</c>.</returns>
    public static string MaterialIcon(string? configured)
        => UsesLogo(configured) ? LogoFallbackIcon : configured!.Trim();

    /// <summary>
    /// Checks whether the icon setting asks for HAPPY's logo; an empty setting does too.
    /// </summary>
    /// <param name="configured">The configured icon.</param>
    /// <returns>Whether jellyfin-web needs the logo stylesheet.</returns>
    public static bool UsesLogo(string? configured)
        => string.IsNullOrWhiteSpace(configured) || string.Equals(configured.Trim(), LogoIcon, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Links a stylesheet at the end of the page's <c>head</c>, once.
    /// </summary>
    /// <param name="html">jellyfin-web's <c>index.html</c>.</param>
    /// <param name="href">The stylesheet's URL.</param>
    /// <returns>The changed page, or the input unchanged when it has no <c>head</c> or links it already.</returns>
    public static string AddStylesheet(string html, string href)
    {
        var end = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
        if (end < 0 || html.Contains($"href=\"{href}\"", StringComparison.Ordinal))
        {
            return html;
        }

        return html.Insert(end, $"<link rel=\"stylesheet\" href=\"{href}\">");
    }

    /// <summary>
    /// Adds a <c>{ name, icon, url }</c> entry to <c>menuLinks</c>, creating the list when it is missing.
    /// Links an admin added by hand are kept, and an entry with the same URL is not added twice.
    /// </summary>
    /// <param name="configJson">jellyfin-web's <c>config.json</c>.</param>
    /// <param name="name">Link text.</param>
    /// <param name="icon">Material icon name.</param>
    /// <param name="url">Link target.</param>
    /// <returns>The changed JSON, or the input unchanged when it is not a JSON object.</returns>
    public static string AddMenuLink(string configJson, string name, string icon, string url)
    {
        JsonObject config;
        try
        {
            if (JsonNode.Parse(configJson) is not JsonObject parsed)
            {
                return configJson;
            }

            config = parsed;
        }
        catch (JsonException)
        {
            return configJson;
        }

        if (config["menuLinks"] is not JsonArray links)
        {
            links = [];
            config["menuLinks"] = links;
        }

        if (links.OfType<JsonObject>().Any(link => link["url"] is JsonValue value
                && value.TryGetValue<string>(out var existing)
                && string.Equals(existing, url, StringComparison.Ordinal)))
        {
            return configJson;
        }

        links.Add(new JsonObject { ["name"] = name, ["icon"] = icon, ["url"] = url });
        return config.ToJsonString(Indented);
    }
}
