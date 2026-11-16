<template>
    <template
        v-for='(b, i) in blocks'
        :key='i'
    >
        <h3
            v-if='b.t === "h" && b.level < 4'
            :id='guideAnchorId(b.id)'
            class='h3 mt-4 mb-2'
        >
            <GuideInline :nodes='b.c' />
        </h3>
        <h4
            v-else-if='b.t === "h"'
            :id='guideAnchorId(b.id)'
            class='h4 mt-3 mb-2'
        >
            <GuideInline :nodes='b.c' />
        </h4>
        <p
            v-else-if='b.t === "p"'
            class='mb-2'
        >
            <GuideInline :nodes='b.c' />
        </p>
        <ol
            v-else-if='b.t === "ol"'
            class='guide-steps mb-2'
        >
            <li
                v-for='(item, j) in b.items'
                :key='j'
            >
                <GuideInline :nodes='item' />
            </li>
        </ol>
        <ul
            v-else-if='b.t === "ul"'
            class='mb-2 ps-4'
        >
            <li
                v-for='(item, j) in b.items'
                :key='j'
            >
                <GuideInline :nodes='item' />
            </li>
        </ul>
        <div
            v-else-if='b.t === "callout"'
            class='alert d-block py-2 px-3 mb-2'
            :class='CALLOUT[b.kind].cls'
            role='note'
        >
            <div class='fw-semibold mb-1'>
                {{ CALLOUT[b.kind].label }}
            </div>
            <div class='guide-callout-body'>
                <GuideBlocks :blocks='b.blocks' />
            </div>
        </div>
        <div
            v-else-if='b.t === "table"'
            class='table-responsive mb-2'
        >
            <table class='table table-sm table-bordered mb-0'>
                <thead>
                    <tr>
                        <th
                            v-for='(cell, j) in b.head'
                            :key='j'
                            scope='col'
                        >
                            <GuideInline :nodes='cell' />
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for='(row, r) in b.rows'
                        :key='r'
                    >
                        <td
                            v-for='(cell, j) in row'
                            :key='j'
                        >
                            <GuideInline :nodes='cell' />
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </template>
</template>

<script setup lang="ts">
import type { Block, CalloutKind } from '../lib/guide.ts';
import { guideAnchorId } from '../lib/guide.ts';
import GuideInline from './GuideInline.vue';

// The blocks of one User Guide section (see lib/guide.ts). A tip or warning box holds blocks of its
// own, so this component also renders itself.
defineProps<{ blocks: Block[] }>();

// Same names as GitHub's boxes, so a box reads the same in the pane and on GitHub.
const CALLOUT: Record<CalloutKind, { label: string; cls: string }> = {
    note:      { label: 'Note',      cls: 'alert-info' },
    tip:       { label: 'Tip',       cls: 'alert-success' },
    important: { label: 'Important', cls: 'alert-primary' },
    warning:   { label: 'Warning',   cls: 'alert-warning' },
    caution:   { label: 'Caution',   cls: 'alert-danger' },
};
</script>

<style scoped>
/* Numbered steps: one action per number, the number in a circle. */
.guide-steps {
    list-style: none;
    counter-reset: guide-step;
    padding-left: 0;
}
.guide-steps > li {
    counter-increment: guide-step;
    position: relative;
    padding-left: 2rem;
    margin-bottom: .4rem;
    min-height: 1.5rem;
}
.guide-steps > li::before {
    content: counter(guide-step);
    position: absolute;
    left: 0;
    top: 0;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background: var(--tblr-warning, #f59f00);
    color: #1d273b;
    font-weight: 600;
    font-size: .8rem;
    display: flex;
    align-items: center;
    justify-content: center;
}
/* The box's colour marks it; its text stays the normal colour, easier to read. */
.guide-callout-body {
    color: var(--tblr-body-color);
}
.guide-callout-body > :last-child {
    margin-bottom: 0;
}
[id] {
    scroll-margin-top: .5rem;
}
</style>
