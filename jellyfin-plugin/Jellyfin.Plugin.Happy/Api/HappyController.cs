using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Mime;
using System.Reflection;
using System.Threading.Tasks;
using Jellyfin.Plugin.Happy.Configuration;
using Jellyfin.Plugin.Happy.Funscripts;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Happy.Api;

/// <summary>
/// HAPPY endpoints. Every route requires a signed-in Jellyfin user and only exposes
/// scripts of items that user can see.
/// </summary>
[ApiController]
[Authorize]
[Route("Happy")]
public class HappyController : ControllerBase
{
    private readonly FunscriptIndex _index;
    private readonly ILibraryManager _libraryManager;
    private readonly IAuthorizationContext _authorizationContext;

    /// <summary>
    /// Initializes a new instance of the <see cref="HappyController"/> class.
    /// </summary>
    /// <param name="index">The funscript index.</param>
    /// <param name="libraryManager">Instance of the <see cref="ILibraryManager"/> interface.</param>
    /// <param name="authorizationContext">Instance of the <see cref="IAuthorizationContext"/> interface.</param>
    public HappyController(FunscriptIndex index, ILibraryManager libraryManager, IAuthorizationContext authorizationContext)
    {
        _index = index;
        _libraryManager = libraryManager;
        _authorizationContext = authorizationContext;
    }

    /// <summary>
    /// Gets the plugin version and build details; HAPPY shows them as its own version.
    /// </summary>
    /// <returns>The plugin info.</returns>
    [HttpGet("Info")]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult<HappyInfo> GetInfo()
    {
        var assembly = typeof(HappyController).Assembly;
        string? Metadata(string key) => assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(a => a.Key == key)?.Value is { Length: > 0 } value ? value : null;
#if DEBUG
        const string Channel = "dev";
#else
        const string Channel = "stable";
#endif
        return new HappyInfo(
            Plugin.Instance?.Version.ToString() ?? "0.0.0.0",
            Channel,
            Metadata("HappyCommit"),
            Metadata("HappyBuiltAt"));
    }

    /// <summary>
    /// Gets the HAPPY client settings configured on the plugin's dashboard page.
    /// </summary>
    /// <returns>The client settings.</returns>
    [HttpGet("Config")]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult<ClientSettings> GetConfig()
    {
        var settings = ClientSettings.From(Plugin.Instance?.Configuration ?? new PluginConfiguration());
        if (settings.LibraryIds.Count == 0)
        {
            return settings;
        }

        // Libraries deleted since they were selected would make HAPPY ask Jellyfin for unknown parents.
        var existing = _libraryManager.GetVirtualFolders()
            .Select(f => Guid.TryParse(f.ItemId, out var id) ? id.ToString("N") : null)
            .ToHashSet(StringComparer.Ordinal);
        return settings with { LibraryIds = settings.LibraryIds.Where(existing.Contains).ToArray() };
    }

    /// <summary>
    /// Lists the funscripts of every media item the current user can see.
    /// </summary>
    /// <returns>Scripts keyed by item id; items without scripts are omitted.</returns>
    [HttpGet("Funscripts")]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<Dictionary<string, FunscriptDto[]>>> GetFunscripts()
    {
        var user = (await _authorizationContext.GetAuthorizationInfo(Request).ConfigureAwait(false)).User;
        if (user is null)
        {
            return Unauthorized();
        }

        return _index.Current()
            .Where(entry => _libraryManager.GetItemById<BaseItem>(entry.Key, user) is not null)
            .ToDictionary(
                entry => entry.Key.ToString("N"),
                entry => entry.Value.Select(f => new FunscriptDto(f.Key, f.FileName)).ToArray());
    }

    /// <summary>
    /// Gets the raw JSON of one funscript of an item.
    /// </summary>
    /// <param name="itemId">The item id.</param>
    /// <param name="key">The script key from <see cref="GetFunscripts"/>.</param>
    /// <returns>The funscript file.</returns>
    [HttpGet("Items/{itemId}/Funscripts/{key}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult> GetFunscript([FromRoute] Guid itemId, [FromRoute] string key)
    {
        var user = (await _authorizationContext.GetAuthorizationInfo(Request).ConfigureAwait(false)).User;
        if (user is null)
        {
            return Unauthorized();
        }

        // Unknown, hidden and script-less items all look the same to the caller.
        if (_libraryManager.GetItemById<BaseItem>(itemId, user) is null
            || !_index.Current().TryGetValue(itemId, out var files)
            || files.Find(f => string.Equals(f.Key, key, StringComparison.Ordinal)) is not { } file
            || !System.IO.File.Exists(file.Path))
        {
            return NotFound();
        }

        return PhysicalFile(file.Path, MediaTypeNames.Application.Json);
    }
}
