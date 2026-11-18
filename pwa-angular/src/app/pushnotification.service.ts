import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { PUSH_ADMIN_URL, PUSH_API_URL, PUSH_SEND_URL } from './push.config';

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private readonly swPush = inject(SwPush);
  private readonly http = inject(HttpClient);

  readonly isSupported = this.swPush.isEnabled;
  readonly enabled = signal(false);
  readonly changingSubscription = signal(false);
  readonly lastResult = signal<string | null>(null);
  readonly adminUrl = PUSH_ADMIN_URL;

  constructor() {
    void this.checkSubscription();
  }

  async toggle(): Promise<void> {
    if (!this.isSupported || this.changingSubscription()) return;
    this.changingSubscription.set(true);
    this.lastResult.set(null);
    try {
      if (this.enabled()) {
        await this.unsubscribe();
      } else {
        await this.subscribe();
      }
    } catch {
      this.lastResult.set('No se pudo cambiar el estado de los avisos. Revisa el permiso del navegador y la conexión.');
    } finally {
      this.changingSubscription.set(false);
    }
  }

  private async subscribe(): Promise<void> {
    const { publicKey } = await this.getConfig();
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !this.usesKey(subscription, publicKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await this.swPush.requestSubscription({ serverPublicKey: publicKey });
    await this.sync('subscribe', subscription);
    this.enabled.set(true);
  }

  private async unsubscribe(): Promise<void> {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await this.sync('unsubscribe', subscription);
      await subscription.unsubscribe();
    }
    this.enabled.set(false);
  }

  async notify(title: string, body: string): Promise<void> {
    try {
      const count = await this.send(title, body);
      this.lastResult.set(`Notificación enviada a ${count} suscripción(es).`);
    } catch (error) {
      this.lastResult.set(this.sendErrorMessage(error));
    }
  }

  async send(title: string, body: string): Promise<number> {
    const response = await firstValueFrom(
      this.http.post<{ enviadas: number; fallidas: number }>(PUSH_SEND_URL, { title, body }, { timeout: 300000 }),
    );
    if (!response.enviadas && response.fallidas) throw new Error('Falló la entrega del aviso.');
    return response.enviadas;
  }

  sendErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return 'Inicia sesión en «Administrar avisos» para enviar notificaciones.';
    }
    return 'No se pudo enviar el aviso.';
  }

  private async checkSubscription(): Promise<void> {
    if (!this.isSupported) return;
    this.changingSubscription.set(true);
    try {
      const { publicKey } = await this.getConfig();
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription && this.usesKey(subscription, publicKey)) {
        await this.sync('subscribe', subscription);
        this.enabled.set(true);
      }
    } catch {
      this.lastResult.set('No se pudo comprobar la suscripción de avisos.');
    } finally {
      this.changingSubscription.set(false);
    }
  }

  private getConfig(): Promise<{ publicKey: string }> {
    return firstValueFrom(this.http.get<{ publicKey: string }>(`${PUSH_API_URL}/config`, { timeout: 10000 }));
  }

  private sync(action: 'subscribe' | 'unsubscribe', subscription: PushSubscription): Promise<unknown> {
    return firstValueFrom(this.http.post(`${PUSH_API_URL}/${action}`, subscription.toJSON(), { timeout: 10000 }));
  }

  private usesKey(subscription: PushSubscription, publicKey: string): boolean {
    const key = subscription.options.applicationServerKey;
    return key !== null && btoa(String.fromCharCode(...new Uint8Array(key)))
      .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') === publicKey;
  }
}
