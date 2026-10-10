/** The subset of Jellyfin's API shapes HAPPY reads. Jellyfin serializes JSON in PascalCase. */

export interface JellyfinTrickplayDto {
    Width: number;
    Height: number;
    /** Thumbnails per sheet row. */
    TileWidth: number;
    /** Thumbnail rows per sheet. */
    TileHeight: number;
    ThumbnailCount: number;
    /** Milliseconds between thumbnails. */
    Interval: number;
}

export interface JellyfinChapterDto {
    StartPositionTicks: number;
    Name?: string | null;
}

/** The signed-in user's data on an item (`EnableUserData=true`). */
export interface JellyfinUserDataDto {
    IsFavorite?: boolean | null;
}

/** `BaseItemDto`, requested with `Fields=Path,Tags,Genres,Overview,Chapters,Trickplay`. */
export interface JellyfinItemDto {
    Id: string;
    Name?: string | null;
    Type: string;
    MediaType?: string | null;
    Path?: string | null;
    Overview?: string | null;
    Tags?: string[] | null;
    Genres?: string[] | null;
    Album?: string | null;
    AlbumArtist?: string | null;
    Artists?: string[] | null;
    ProductionYear?: number | null;
    IndexNumber?: number | null;
    /** 100 ns ticks. */
    RunTimeTicks?: number | null;
    ImageTags?: Record<string, string> | null;
    Chapters?: JellyfinChapterDto[] | null;
    /** Media source id → resolution (thumbnail width) → sheet layout. */
    Trickplay?: Record<string, Record<string, JellyfinTrickplayDto>> | null;
    UserData?: JellyfinUserDataDto | null;
    /** Only with `Fields=CanDelete`. */
    CanDelete?: boolean;
}

export interface JellyfinItemsResult {
    Items: JellyfinItemDto[];
}

export interface JellyfinAuthResult {
    AccessToken: string;
    User: { Id: string; Name: string };
}

/** `GET /Happy/Funscripts` of the HAPPY plugin: item id → scripts next to that item's file. */
export type HappyFunscriptListing = Record<string, { Key: string; FileName: string }[]>;

/** A Jellyfin playlist with its entries, in playlist order. */
export interface JellyfinPlaylist {
    item: JellyfinItemDto;
    entries: JellyfinItemDto[];
}
