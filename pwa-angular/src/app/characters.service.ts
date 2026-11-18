import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, of, throwError } from 'rxjs';

export interface Character {
  id: number;
  name: string;
  status: 'Alive' | 'Dead' | 'unknown';
  species: string;
  image: string;
  origin: { name: string };
  location: { name: string };
}

export interface CharacterPage {
  info: { count: number; pages: number; next: string | null; prev: string | null };
  results: Character[];
}

@Injectable({ providedIn: 'root' })
export class CharactersService {
  private readonly http = inject(HttpClient);

  list(page: number, name: string, status: string) {
    return this.http.get<CharacterPage>('https://rickandmortyapi.com/api/character', {
      params: { page, name: name.trim(), status }, timeout: 12000,
    }).pipe(catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        return of<CharacterPage>({ info: { count: 0, pages: 0, next: null, prev: null }, results: [] });
      }
      return throwError(() => error);
    }));
  }
}
