export interface ArtistDto {
  name: string;
  genre?: string;
  city?: string;
}

export interface SongDto {
  title: string;
  artistId?: string;
  artist?: string;
  genre?: string;
  priceCdf?: number;
  duration?: string;
  audioPath?: string;
  coverPath?: string;
  audioData?: string;
  audioName?: string;
  coverData?: string;
  coverName?: string;
}
