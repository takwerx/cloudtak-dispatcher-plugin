<template>
    <div
        ref='root'
        @click='follow'
    >
        <!-- Contents: every section and its parts, so a reader goes straight to the task. The pane's
             Contents button comes back here. -->
        <div :id='guideAnchorId(CONTENTS_ANCHOR)'>
            <p class='text-muted small mb-3'>
                For the Dispatcher plugin, version {{ version }}.
            </p>
            <nav
                aria-label='Contents'
                class='mb-3'
            >
                <div class='fw-semibold mb-1'>
                    Contents
                </div>
                <ol class='mb-0 ps-4'>
                    <li
                        v-for='s in sections'
                        :key='s.id'
                        class='mb-1'
                    >
                        <a
                            :href='`#${s.id}`'
                            :data-guide-target='s.id'
                        >{{ s.title }}</a>
                        <ul
                            v-if='parts[s.id].length'
                            class='list-unstyled small ps-2 mb-0'
                        >
                            <li
                                v-for='p in parts[s.id]'
                                :key='p.id'
                            >
                                <a
                                    :href='`#${p.id}`'
                                    :data-guide-target='p.id'
                                >{{ p.title }}</a>
                            </li>
                        </ul>
                    </li>
                </ol>
            </nav>
        </div>
        <section
            v-for='(s, n) in sections'
            :id='guideAnchorId(s.id)'
            :key='s.id'
            class='border-top pt-2 mt-3'
        >
            <h2 class='h2 mt-2 mb-2'>
                {{ n + 1 }}. {{ s.title }}
            </h2>
            <GuideBlocks :blocks='s.blocks' />
        </section>
        <p
            v-if='!sections.length'
            class='text-muted'
        >
            The guide's files are missing from this install.
        </p>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { version } from '../package.json';
import { buildGuide, CONTENTS_ANCHOR, guideAnchorId, sectionParts } from '../lib/guide.ts';
import GuideBlocks from './GuideBlocks.vue';

// The User Guide's text: every numbered Markdown file in plugin/guide/ (its README says how to add
// one), bundled with the plugin, so the guide works without internet and matches this version.
const files = import.meta.glob<string>('../guide/[0-9]*.md', { query: '?raw', import: 'default', eager: true });
const sections = buildGuide(files);
const parts = Object.fromEntries(sections.map(s => [s.id, sectionParts(s)]));

const root = ref<HTMLElement | null>(null);

// Scroll the guide to a section or heading. Only the guide's own scroll box moves (scrollIntoView
// would also scroll the map's containers), and CloudTAK's address is left alone.
function show(anchor: string): void {
    const target = root.value?.querySelector<HTMLElement>(`#${CSS.escape(guideAnchorId(anchor))}`);
    if (!target) return;
    for (let box = target.parentElement; box; box = box.parentElement) {
        const overflow = getComputedStyle(box).overflowY;
        if ((overflow === 'auto' || overflow === 'scroll') && box.scrollHeight > box.clientHeight) {
            // The contents sit at the very top; anything else lands just below the top edge.
            const top = anchor === CONTENTS_ANCHOR ? 0
                : box.scrollTop + target.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
            box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
            return;
        }
    }
}

// A link inside the guide goes to its section or heading.
function follow(e: MouseEvent) {
    const link = (e.target as Element | null)?.closest('a[data-guide-target]');
    if (!link) return;
    e.preventDefault();
    show(link.getAttribute('data-guide-target') ?? '');
}

defineExpose({ show });
</script>
