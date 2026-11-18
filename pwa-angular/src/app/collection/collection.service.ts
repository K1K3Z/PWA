import { Injectable, signal } from '@angular/core';
import { Character } from '../characters.service';

export interface CollectionEntry {
  character: Character;
  notes: string;
}

function isEntry(value: unknown): value is CollectionEntry {
  if (!value || typeof value !== 'object' || !('character' in value) || !('notes' in value)) return false;
  const character = value.character;
  return typeof value.notes === 'string' && !!character && typeof character === 'object'
    && 'id' in character && Number.isInteger(character.id)
    && 'name' in character && typeof character.name === 'string'
    && 'image' in character && typeof character.image === 'string';
}

@Injectable({ providedIn: 'root' })
export class CollectionService {
  private readonly key = 'enrique.rickmorty.collection.v1';
  private readonly stored = signal<CollectionEntry[]>([]);
  readonly entries = this.stored.asReadonly();
  readonly error = signal('');

  constructor() {
    try {
      const data: unknown = JSON.parse(localStorage.getItem(this.key) ?? '[]');
      if (!Array.isArray(data) || !data.every(isEntry)) throw new Error('Datos inválidos');
      this.stored.set(data);
    } catch {
      this.error.set('No se pudo recuperar la colección guardada en este navegador.');
    }
  }

  contains(id: number): boolean {
    return this.entries().some((entry) => entry.character.id === id);
  }

  add(character: Character): boolean {
    if (this.contains(character.id)) return false;
    this.save([...this.entries(), { character, notes: '' }]);
    return true;
  }

  update(id: number, notes: string): void {
    this.save(this.entries().map((entry) => entry.character.id === id ? { ...entry, notes: notes.trim() } : entry));
  }

  remove(id: number): void {
    this.save(this.entries().filter((entry) => entry.character.id !== id));
  }

  private save(entries: CollectionEntry[]): void {
    localStorage.setItem(this.key, JSON.stringify(entries));
    this.stored.set(entries);
    this.error.set('');
  }
}
