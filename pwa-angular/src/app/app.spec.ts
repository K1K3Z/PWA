import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { PushNotificationService } from './pushnotification.service';
import { CollectionService } from './collection/collection.service';

describe('Explorador de Rick y Morty', () => {
  let fixture: ComponentFixture<App>;
  let http: HttpTestingController;
  let send: ReturnType<typeof vi.fn>;
  const character = {
    id: 1, name: 'Rick Sanchez', status: 'Alive', species: 'Human',
    image: 'https://rickandmortyapi.com/api/character/avatar/1.jpeg',
    origin: { name: 'Earth' }, location: { name: 'Citadel' },
  };
  const data = { info: { count: 1, pages: 1, next: null, prev: null }, results: [character] };
  const storageKey = 'enrique.rickmorty.collection.v1';
  const pageKey = 'rickmorty.page.v1:1::';

  beforeEach(() => {
    localStorage.removeItem(storageKey);
    localStorage.removeItem(pageKey);
    send = vi.fn().mockResolvedValue(1);
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), {
        provide: PushNotificationService,
        useValue: { send, isSupported: false, adminUrl: '/api/shopstore/login.html',
          lastResult: () => null, sendErrorMessage: () => 'No se pudo enviar el aviso.' },
      }],
    });
    fixture = TestBed.createComponent(App);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem(storageKey);
    localStorage.removeItem(pageKey);
  });

  async function refresh(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function button(text: string): HTMLButtonElement {
    const root: HTMLElement = fixture.nativeElement;
    const found = Array.from(root.querySelectorAll('button')).find((item) => item.textContent?.trim() === text);
    if (!found) throw new Error(`No se encontró ${text}`);
    return found;
  }

  function respond(): void {
    http.expectOne((request) => request.url.endsWith('/character')).flush(data);
    fixture.detectChanges();
  }

  it('guarda, edita y elimina una entrada y solo avisa después de persistir', async () => {
    respond();
    button('Guardar personaje').click();
    await refresh();
    expect(send).toHaveBeenLastCalledWith('Colección de Enrique', 'Personaje agregado a la colección.');
    expect(JSON.parse(localStorage.getItem(storageKey) ?? '[]')).toHaveLength(1);
    expect(button('En tu colección').disabled).toBe(true);

    button('Editar notas').click();
    fixture.detectChanges();
    await refresh();
    const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea');
    textarea.value = 'Mi personaje favorito';
    textarea.dispatchEvent(new Event('input'));
    button('Guardar notas').click();
    await refresh();
    expect(fixture.nativeElement.textContent).toContain('Mi personaje favorito');
    expect(send).toHaveBeenLastCalledWith('Colección de Enrique', 'Notas del personaje actualizadas.');

    send.mockRejectedValueOnce(new Error('Sin red'));
    button('Eliminar').click();
    fixture.detectChanges();
    expect(send).toHaveBeenCalledTimes(2);
    button('Confirmar eliminación').click();
    await refresh();
    expect(TestBed.inject(CollectionService).entries()).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('No se pudo enviar el aviso');
  });

  it('recupera la página guardada cuando falla la conexión', async () => {
    localStorage.setItem(pageKey, JSON.stringify(data));
    http.expectOne((request) => request.url.endsWith('/character')).error(new ProgressEvent('error'));
    await refresh();
    expect(fixture.nativeElement.textContent).toContain('Rick Sanchez');
    expect(fixture.nativeElement.textContent).toContain('copia guardada');
    expect(send).not.toHaveBeenCalled();
  });

  it('envía los filtros a la API y muestra el resultado vacío sin error', async () => {
    respond();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[name="name"]');
    input.value = 'Nobody';
    input.dispatchEvent(new Event('input'));
    button('Buscar').click();
    const request = http.expectOne((req) => req.params.get('name') === 'Nobody');
    request.flush({ error: 'There is nothing here' }, { status: 404, statusText: 'Not Found' });
    await refresh();
    expect(fixture.nativeElement.textContent).toContain('No hay personajes');
    localStorage.removeItem('rickmorty.page.v1:1:Nobody:');
  });
});
