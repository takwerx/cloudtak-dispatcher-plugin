import { defineAsyncComponent } from 'vue';
import { useFloatStore } from '../../../src/stores/float.ts';

// The User Guide opens in its own pane over the map, through CloudTAK's FloatStore like the
// Dispatcher pop-out (float-pane.ts), so it can stay open beside the Dispatcher. One guide at a time.
const GUIDE_UID = 'plugin-tak-dispatcher-guide';

// Async import: the guide's text and renderer load only when someone opens it.
const GuideFloat = defineAsyncComponent(() => import('../components/GuideFloat.vue'));

export function openGuide(): void {
    const floats = useFloatStore();
    const open = floats.panes.get(GUIDE_UID);
    if (open) {
        // Already open: bring it to the front (panes draw in the order they were added), as it is.
        floats.panes.delete(GUIDE_UID);
        floats.panes.set(GUIDE_UID, open);
        return;
    }
    // Opens beside the Dispatcher panel (top right) on a CloudTAK whose FloatStore has 'corner'.
    // Passed as a variable, not written inline, so an older CloudTAK without that option still
    // type-checks; its FloatStore ignores the option and opens the guide at the top left.
    const pane = {
        uid:       GUIDE_UID,
        name:      'User Guide',
        component: GuideFloat,
        width:     480,
        height:    Math.max(300, Math.min(720, window.innerHeight - 120)),
        corner:    'top-right' as const,
    };
    floats.add(pane);
}

export function closeGuide(): void {
    useFloatStore().delete(GUIDE_UID);
}
