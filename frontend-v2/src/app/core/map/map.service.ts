import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';
import { MapPoint, MapTiles, MapUnitDetail } from './map.models';

/** Mapa (#24): GET /api/map/* y el fondo en /api/config/map-tiles. */
@Injectable({ providedIn: 'root' })
export class MapService {
  private readonly http = inject(HttpClient);

  async points(): Promise<MapPoint[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<MapPoint[]>>('/api/map/points'))).data;
  }

  async unit(id: string): Promise<MapUnitDetail> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<MapUnitDetail>>(`/api/map/units/${id}`))).data;
  }

  async tiles(): Promise<MapTiles> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<MapTiles>>('/api/config/map-tiles'))).data;
  }

  async saveTiles(tiles: MapTiles): Promise<MapTiles> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<MapTiles>>('/api/config/map-tiles', tiles))).data;
  }
}
