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
/// </summary>
public static class WebConfigMenuLink
{
    /// <summary>
    /// Link target, relative to <c>/web/</c>, so a Jellyfin base URL (<c>/jellyfin/web/</c>) is kept.
    /// </summary>
    public const string HappyUrl = "../Happy/Web/";

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
