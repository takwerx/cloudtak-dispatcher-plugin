<template>
    <template
        v-for='(n, i) in nodes'
        :key='i'
    >
        <span v-if='n.t === "text"'>{{ n.v }}</span>
        <strong v-else-if='n.t === "strong"'><GuideInline :nodes='n.c' /></strong>
        <kbd v-else-if='n.t === "code"'>{{ n.v }}</kbd>
        <a
            v-else-if='n.t === "link" && internalAnchor(n.href)'
            :href='`#${internalAnchor(n.href)}`'
            :data-guide-target='internalAnchor(n.href)'
        >
            <GuideInline :nodes='n.c' />
        </a>
        <a
            v-else-if='n.t === "link" && externalHref(n.href)'
            :href='externalHref(n.href)'
            target='_blank'
            rel='noopener noreferrer'
        >
            <GuideInline :nodes='n.c' />
        </a>
        <GuideInline
            v-else-if='n.t === "link"'
            :nodes='n.c'
        />
    </template>
</template>

<script setup lang="ts">
import type { Inline } from '../lib/guide.ts';
import { resolveLink } from '../lib/guide.ts';

// Text inside a User Guide block (see lib/guide.ts). Links within the guide carry their target in
// data-guide-target; UserGuide scrolls to it instead of changing CloudTAK's address.
defineProps<{ nodes: Inline[] }>();

function internalAnchor(href: string): string {
    const to = resolveLink(href);
    return to.kind === 'internal' ? to.anchor : '';
}

function externalHref(href: string): string {
    const to = resolveLink(href);
    return to.kind === 'external' ? to.href : '';
}
</script>
