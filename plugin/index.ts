import type { App } from 'vue';
import { markRaw } from 'vue';
import type { PluginAPI, PluginInstance } from '../../plugin.ts';
import type { MenuItemConfig } from '../../plugin.ts';
import { IconHeadset } from '@tabler/icons-vue';
import CadMain from './components/CadMain.vue';
import { dockDispatcher } from './lib/float-pane.ts';
import { closeAllUndocked } from './lib/undock-panes.ts';
import { loadPanelOpen, shouldReopenPanel } from './lib/panel-state.ts';
import { closeGuide } from './lib/guide-pane.ts';
import { getDispatcherAccess } from './lib/events-client.ts';

const MENU_KEY   = 'plugin-tak-dispatcher';
const ROUTE_NAME = 'home-menu-tak-dispatcher';

export default class DispatcherPlugin implements PluginInstance {
    api: PluginAPI;
    // Counts enable() and disable() calls, so an enable() still waiting on the access check when
    // disable() (or another enable()) runs does not add the menu item afterwards.
    private turn = 0;

    constructor(api: PluginAPI) {
        this.api = api;
    }

    static async install(app: App, api: PluginAPI): Promise<DispatcherPlugin> {
        void app;
        api.routes.add(
            { path: 'tak-dispatcher', name: ROUTE_NAME, component: CadMain },
            'home-menu'
        );
        return new DispatcherPlugin(api);
    }

    async enable(): Promise<void> {
        // Who Can Use Dispatcher: a user the admin has not let in gets no menu item. The page itself
        // says so too (CadMain.vue) for anyone who opens its address. CloudTAK waits for each plugin's
        // enable() in turn, so the check runs on its own and enable() returns at once.
        const turn = ++this.turn;
        const startRoute = this.api.router.currentRoute.value.name;
        void getDispatcherAccess()
            .then(mayUse => (mayUse && turn === this.turn ? this.show(startRoute) : undefined))
            .catch(err => console.error('[dispatcher] menu item not added', err));
    }

    // Adds the menu item and, after a reload of the Dispatcher page, opens it again.
    private async show(startRoute: unknown): Promise<void> {
        this.api.menu.add({
            key:         MENU_KEY,
            label:       'Dispatcher',
            route:       ROUTE_NAME,
            tooltip:     'CloudTAK Dispatcher',
            description: 'Dispatch incidents on the map — works standalone or with TAK-CAD server plugin',
            icon:        markRaw(IconHeadset) as unknown as MenuItemIconType,
        } as MenuItemConfig);
        // A reload of the Dispatcher page lands on the map (CloudTAK adds plugin pages after the page loads), so open
        // it again if it was open. Only once the route exists, and only while the user is still where the page
        // loaded (not after they opened something else during the access check); a failed push leaves the map showing.
        try {
            const router = this.api.router;
            if (router.currentRoute.value.name === startRoute
                && shouldReopenPanel(loadPanelOpen(), router.currentRoute.value.name, ROUTE_NAME) && router.hasRoute(ROUTE_NAME)) {
                await router.push({ name: ROUTE_NAME });
            }
        } catch { /* stay on the map */ }
    }

    async disable(): Promise<void> {
        this.turn++;
        // Only remove the menu item. Do NOT remove the route: CloudTAK calls
        // disable() on every page load before enable() (the isLoaded watcher
        // fires immediately with isLoaded=false), so removing the route here
        // makes the subsequent enable() menu.add fail with "route not found".
        // The route is registered once in install() and left in place — same
        // pattern as the working ping plugin.
        try { this.api.menu.remove(MENU_KEY); } catch { /* ignore */ }
        // Also retract the floating pane if detached (no-op on the load-time disable()
        // calls — the pane store starts empty on every page load).
        try { dockDispatcher(); } catch { /* ignore */ }
        // Same for undocked incident cards; the saved list is kept so they come back on re-enable.
        try { closeAllUndocked(false); } catch { /* ignore */ }
        try { closeGuide(); } catch { /* ignore */ }
    }
}

type MenuItemIconType = NonNullable<Parameters<PluginAPI['menu']['add']>[0]['icon']>;
