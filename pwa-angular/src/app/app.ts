import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { CharactersService, Character, CharacterPage } from './characters.service';
import { Collection } from './collection/collection';
import { CollectionService } from './collection/collection.service';
import { PushNotificationService } from './pushnotification.service';

@Component({
  selector: 'app-root', imports: [FormsModule, Collection, RouterLink, RouterOutlet],
  templateUrl: './app.html', styleUrl: './app.css',
})
export class App implements OnInit {
  private readonly api = inject(CharactersService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly collection = inject(CollectionService);
  protected readonly push = inject(PushNotificationService);
  protected readonly characters = signal<Character[]>([]);
  protected readonly info = signal<CharacterPage['info']>({ count: 0, pages: 0, next: null, prev: null });
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly sending = signal(false);
  protected readonly page = signal(1);
  protected readonly cached = signal(false);
  protected name = '';
  protected status = '';
  private activeName = '';
  private activeStatus = '';
  private request?: Subscription;

  ngOnInit(): void { this.load(); }

  protected search(): void {
    this.activeName = this.name.trim();
    this.activeStatus = this.status;
    this.page.set(1);
    this.load();
  }

  protected changePage(delta: number): void {
    this.page.update((page) => page + delta);
    this.load();
  }

  protected load(): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set('');
    this.cached.set(false);
    const key = `rickmorty.page.v1:${this.page()}:${this.activeName}:${this.activeStatus}`;
    this.request = this.api.list(this.page(), this.activeName, this.activeStatus)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (data) => {
          this.show(data);
          try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* La caché del service worker sigue disponible. */ }
        },
        error: () => {
          try {
            const data = JSON.parse(localStorage.getItem(key) ?? 'null') as CharacterPage | null;
            if (!data || !Array.isArray(data.results) || !data.info) throw new Error('Sin copia');
            this.show(data);
            this.cached.set(true);
          } catch {
            this.characters.set([]);
            this.info.set({ count: 0, pages: 0, next: null, prev: null });
            this.loading.set(false);
            this.error.set('No se pudo cargar esta búsqueda. Conéctate para cargarla por primera vez o vuelve a una página consultada.');
          }
        },
      });
  }

  private show(data: CharacterPage): void {
    this.characters.set(data.results);
    this.info.set(data.info);
    this.loading.set(false);
  }

  protected statusLabel(status: Character['status']): string {
    return { Alive: 'Vivo', Dead: 'Muerto', unknown: 'Desconocido' }[status];
  }

  protected async add(character: Character): Promise<void> {
    if (this.sending()) return;
    this.sending.set(true);
    try {
      if (!this.collection.add(character)) return;
      const message = 'Personaje agregado a la colección.';
      this.notice.set(message);
      try {
        const count = await this.push.send('Colección de Enrique', message);
        this.notice.set(`${message} Aviso enviado a ${count} suscripción(es).`);
      } catch (error) {
        this.notice.set(`${message} ${this.push.sendErrorMessage(error)}`);
      }
    } catch {
      this.notice.set('No se pudo guardar el personaje en este navegador.');
    } finally { this.sending.set(false); }
  }

  protected async testNotification(): Promise<void> {
    if (this.sending()) return;
    this.sending.set(true);
    try {
      await this.push.notify('Explorador de Enrique', 'Tu explorador de Rick y Morty está listo para recibir avisos.');
    } finally { this.sending.set(false); }
  }
}
