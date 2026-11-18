import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CollectionEntry, CollectionService } from './collection.service';
import { PushNotificationService } from '../pushnotification.service';

@Component({
  selector: 'app-collection',
  imports: [FormsModule],
  templateUrl: './collection.html',
  styleUrl: './collection.css',
})
export class Collection {
  protected readonly collection = inject(CollectionService);
  private readonly push = inject(PushNotificationService);
  protected readonly editing = signal<number | null>(null);
  protected readonly removing = signal<number | null>(null);
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly error = signal('');
  protected notes = '';

  protected edit(entry: CollectionEntry): void {
    this.editing.set(entry.character.id);
    this.removing.set(null);
    this.notes = entry.notes;
    this.error.set('');
  }

  protected async save(entry: CollectionEntry): Promise<void> {
    if (this.notes.length > 500) {
      this.error.set('Las notas deben tener un máximo de 500 caracteres.');
      return;
    }
    await this.change(() => this.collection.update(entry.character.id, this.notes), 'Notas del personaje actualizadas.');
  }

  protected async remove(entry: CollectionEntry): Promise<void> {
    await this.change(() => this.collection.remove(entry.character.id), 'Personaje eliminado de la colección.');
  }

  private async change(action: () => void, notice: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      action();
      this.editing.set(null);
      this.removing.set(null);
      this.message.set(notice);
      try {
        const count = await this.push.send('Colección de Enrique', notice);
        this.message.set(`${notice} Aviso enviado a ${count} suscripción(es).`);
      } catch (error) {
        this.message.set(`${notice} ${this.push.sendErrorMessage(error)}`);
      }
    } catch {
      this.error.set('No se pudo guardar el cambio en este navegador.');
    } finally {
      this.busy.set(false);
    }
  }
}
