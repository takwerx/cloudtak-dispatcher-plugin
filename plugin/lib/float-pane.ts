import { defineAsyncComponent } from 'vue';
import { useFloatStore } from '../../../src/stores/float.ts';
import { dispatcherStore } from './dispatcher-store.ts';

// Detach/re-attach the Dispatcher as a draggable, resizable pane over the map using
// CloudTAK's own FloatStore (generic add() exists since 13.45, which this plugin already
// requires for its server routes). The pane is a singleton keyed by this uid.
const PANE_UID = 'plugin-tak-dispatcher-float';

// Async import so CadMain (which triggers pop-out) and DispatcherFloat (which hosts
// CadMain) don't form a static import cycle.
const DispatcherFloat = defineAsyncComponent(() => import('../components/DispatcherFloat.vue'));

export function popOutDispatcher(): void {
    useFloatStore().add({
        uid:       PANE_UID,
        name:      'Dispatcher',
        component: DispatcherFloat,
        width:     420,
        height:    640,
    });
    dispatcherStore.floating = true;
}

export function dockDispatcher(): void {
    useFloatStore().delete(PANE_UID);
    dispatcherStore.floating = false;
}
