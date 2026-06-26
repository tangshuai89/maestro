import { Injectable } from '@nestjs/common';
import { MusicProvider } from '../common/provider';

export interface Track {
  id: string;
  provider: MusicProvider;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  audioUrl: string;
  duration: number; // seconds
  liked: boolean;
}

/**
 * In production each provider would call its own API:
 * - QQ Music:  radio playlist + like endpoints
 * - NetEase:   私人FM (/personal_fm) + like endpoints
 *
 * For demo purposes we use curated public-domain tracks, with a distinct
 * catalogue per provider so switching the source is visibly different.
 */
@Injectable()
export class MusicService {
  private readonly catalogues: Record<MusicProvider, Track[]> = {
    qq: [
      {
        id: 'qq-1',
        provider: 'qq',
        title: 'Clair de Lune',
        artist: 'Claude Debussy',
        album: 'Suite bergamasque',
        coverUrl:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Claude_Debussy_ca_1908%2C_foto_av_F%C3%A9lix_Nadar.jpg/440px-Claude_Debussy_ca_1908%2C_foto_av_F%C3%A9lix_Nadar.jpg',
        audioUrl:
          'https://upload.wikimedia.org/wikipedia/commons/7/75/Clair_de_lune_%28Debussy%29.ogg',
        duration: 302,
        liked: false,
      },
      {
        id: 'qq-2',
        provider: 'qq',
        title: 'Gymnop\u00e9die No. 1',
        artist: 'Erik Satie',
        album: 'Trois Gymnop\u00e9dies',
        coverUrl:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Erik_Satie_en_1909.jpg/440px-Erik_Satie_en_1909.jpg',
        audioUrl:
          'https://upload.wikimedia.org/wikipedia/commons/e/ee/Erik_Satie_-_gymnop%C3%A9die_no.1.ogg',
        duration: 190,
        liked: false,
      },
      {
        id: 'qq-3',
        provider: 'qq',
        title: 'Nocturne Op. 9 No. 2',
        artist: 'Fr\u00e9d\u00e9ric Chopin',
        album: 'Nocturnes',
        coverUrl:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Frederic_Chopin_photo.jpeg/440px-Frederic_Chopin_photo.jpeg',
        audioUrl:
          'https://upload.wikimedia.org/wikipedia/commons/e/e3/Frederic_Chopin_-_nocturne_op._9_no._2.ogg',
        duration: 271,
        liked: false,
      },
      {
        id: 'qq-4',
        provider: 'qq',
        title: 'Arabesque No. 1',
        artist: 'Claude Debussy',
        album: 'Deux Arabesques',
        coverUrl:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Claude_Debussy_ca_1908%2C_foto_av_F%C3%A9lix_Nadar.jpg/440px-Claude_Debussy_ca_1908%2C_foto_av_F%C3%A9lix_Nadar.jpg',
        audioUrl:
          'https://upload.wikimedia.org/wikipedia/commons/4/49/Claude_Debussy_-_Arabesque_No._1.ogg',
        duration: 256,
        liked: false,
      },
      {
        id: 'qq-5',
        provider: 'qq',
        title: 'Moonlight Sonata',
        artist: 'Ludwig van Beethoven',
        album: 'Piano Sonata No. 14',
        coverUrl:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Beethoven.jpg/440px-Beethoven.jpg',
        audioUrl:
          'https://upload.wikimedia.org/wikipedia/commons/3/32/Ludwig_van_Beethoven_-_Moonlight_Sonata.ogg',
        duration: 360,
        liked: false,
      },
      {
        id: 'qq-6',
        provider: 'qq',
        title: 'Rêverie',
        artist: 'Claude Debussy',
        album: 'Rêverie',
        coverUrl:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Claude_Debussy_ca_1908%2C_foto_av_F%C3%A9lix_Nadar.jpg/440px-Claude_Debussy_ca_1908%2C_foto_av_F%C3%A9lix_Nadar.jpg',
        audioUrl:
          'https://upload.wikimedia.org/wikipedia/commons/0/09/Debussy_-_R%C3%AAverie.ogg',
        duration: 240,
        liked: false,
      },
    ],
    netease: [
      {
        id: 'netease-1',
        provider: 'netease',
        title: 'The Four Seasons - Spring',
        artist: 'Antonio Vivaldi',
        album: 'Le quattro stagioni',
        coverUrl:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Vivaldi.jpg/440px-Vivaldi.jpg',
        audioUrl:
          'https://upload.wikimedia.org/wikipedia/commons/9/9f/Vivaldi_Spring_mvt_1_Allegro_-_John_Harrison_violin.ogg',
        duration: 205,
        liked: false,
      },
      {
        id: 'netease-2',
        provider: 'netease',
        title: 'Eine kleine Nachtmusik',
        artist: 'W. A. Mozart',
        album: 'Serenade No. 13',
        coverUrl:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Wolfgang-amadeus-mozart_1.jpg/440px-Wolfgang-amadeus-mozart_1.jpg',
        audioUrl:
          'https://upload.wikimedia.org/wikipedia/commons/7/76/Mozart_-_Eine_kleine_Nachtmusik_-_1._Allegro.ogg',
        duration: 348,
        liked: false,
      },
      {
        id: 'netease-3',
        provider: 'netease',
        title: 'Canon in D',
        artist: 'Johann Pachelbel',
        album: 'Canon and Gigue',
        coverUrl:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Johann_Pachelbel.jpg/440px-Johann_Pachelbel.jpg',
        audioUrl:
          'https://upload.wikimedia.org/wikipedia/commons/3/3e/Canon_in_D_Major.ogg',
        duration: 360,
        liked: false,
      },
      {
        id: 'netease-4',
        provider: 'netease',
        title: 'Hungarian Dance No. 5',
        artist: 'Johannes Brahms',
        album: 'Hungarian Dances',
        coverUrl:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/JohannesBrahms.jpg/440px-JohannesBrahms.jpg',
        audioUrl:
          'https://upload.wikimedia.org/wikipedia/commons/c/c8/Brahms_Hungarian_Dance_No._5_in_G_minor.ogg',
        duration: 156,
        liked: false,
      },
      {
        id: 'netease-5',
        provider: 'netease',
        title: 'Ave Maria',
        artist: 'Franz Schubert',
        album: 'Ellens dritter Gesang',
        coverUrl:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Franz_Schubert_by_Wilhelm_August_Rieder_1875.jpg/440px-Franz_Schubert_by_Wilhelm_August_Rieder_1875.jpg',
        audioUrl:
          'https://upload.wikimedia.org/wikipedia/commons/1/1d/Schubert_Ave_Maria.ogg',
        duration: 270,
        liked: false,
      },
      {
        id: 'netease-6',
        provider: 'netease',
        title: 'Für Elise',
        artist: 'Ludwig van Beethoven',
        album: 'Bagatelle No. 25',
        coverUrl:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Beethoven.jpg/440px-Beethoven.jpg',
        audioUrl:
          'https://upload.wikimedia.org/wikipedia/commons/0/0b/Fur_Elise.ogg',
        duration: 175,
        liked: false,
      },
    ],
  };

  private readonly likedTrackIds: Record<MusicProvider, Set<string>> = {
    qq: new Set<string>(),
    netease: new Set<string>(),
  };

  private readonly playHistory: Record<MusicProvider, string[]> = {
    qq: [],
    netease: [],
  };

  getNextTrack(provider: MusicProvider): Track {
    const tracks = this.catalogues[provider];
    const history = this.playHistory[provider];
    // Radio-style: pick a random track, avoid repeating the last played.
    const lastPlayed = history[history.length - 1];
    let candidates = tracks.filter((t) => t.id !== lastPlayed);
    if (candidates.length === 0) {
      candidates = tracks;
    }
    const track = candidates[Math.floor(Math.random() * candidates.length)];
    history.push(track.id);
    if (history.length > 50) {
      this.playHistory[provider] = history.slice(-20);
    }
    return { ...track, liked: this.likedTrackIds[provider].has(track.id) };
  }

  likeTrack(
    provider: MusicProvider,
    trackId: string,
  ): { success: boolean; liked: boolean } {
    const liked = this.likedTrackIds[provider];
    if (liked.has(trackId)) {
      liked.delete(trackId);
      return { success: true, liked: false };
    }
    liked.add(trackId);
    return { success: true, liked: true };
  }

  getLikedTracks(provider: MusicProvider): Track[] {
    const liked = this.likedTrackIds[provider];
    return this.catalogues[provider]
      .filter((t) => liked.has(t.id))
      .map((t) => ({ ...t, liked: true }));
  }
}
