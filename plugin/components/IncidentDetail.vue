<template>
    <div
        class='d-flex flex-column h-100 overflow-hidden'
    >
        <!-- Header: only inside the menu panel (Back, title, Undock). An undocked card gets its header from the floating pane. -->
        <div
            v-if='!floating && inc'
            class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'
        >
            <button
                class='btn btn-sm btn-outline-secondary'
                @click='emit("back")'
            >
                ← Back
            </button>
            <span
                class='fw-semibold text-truncate flex-grow-1'
                :title='`${inc.number} ${inc.type ?? ""}`'
            >{{ inc.number }} {{ inc.type }}</span>
            <!-- Undock: open this incident in its own window, so several incidents can be open at once. The panel
                 goes back to the list. Grayed out while the incident already has its window. -->
            <button
                class='btn btn-sm btn-outline-secondary d-flex align-items-center'
                :disabled='alreadyUndocked'
                :title='alreadyUndocked ? "Already open in its own window" : "Undock: open this incident in its own window"'
                data-test='undock'
                @click='undock'
            >
                <IconPictureInPictureOn
                    :size='16'
                    stroke='1'
                />
            </button>
        </div>
        <div
            v-if='!inc'
            class='text-center text-muted py-4 small'
        >
            This incident is no longer on the board.
        </div>
        <div
            v-else
            class='flex-grow-1 overflow-auto p-3 d-flex flex-column gap-3'
        >
            <!-- Status row. The header (panel or floating pane) has room for the title and its buttons
                 only at the default width, so the status and board badges live here in both. -->
            <div
                class='d-flex align-items-center gap-2'
                data-test='status-row'
            >
                <span
                    class='badge'
                    :class='inc.status === "active" ? "bg-success text-white" : "bg-secondary text-white"'
                >{{ inc.status }}</span>
                <span
                    v-if='inc.status === "active"'
                    class='badge'
                    :class='boardBadgeClass(inc.assigned)'
                >{{ BOARD_LABEL[boardState(inc.assigned)] }}</span>
            </div>
            <!-- CJIS reminder: one shared line, on by default, Dispatcher Settings → CJIS Reminder (admin only) -->
            <div
                v-if='dispatcherStore.cjisReminder.enabled'
                class='small text-warning border border-warning rounded px-2 py-1'
                role='note'
                data-test='cjis-reminder'
            >
                {{ dispatcherStore.cjisReminder.text }}
            </div>
            <div class='card border'>
                <div class='card-body py-2 px-3 small d-flex flex-column gap-1'>
                    <div class='row g-1'>
                        <div class='col-4 text-muted'>
                            Type
                        </div>
                        <div class='col-8'>
                            {{ inc.type }}
                        </div>
                        <div class='col-4 text-muted'>
                            Time
                        </div>
                        <div class='col-8'>
                            {{ formatTime(inc.created_at) }}
                        </div>
                        <div class='col-4 text-muted'>
                            Address
                        </div>
                        <div class='col-8'>
                            <!-- Changeable whether active or closed: where a call really belongs is often learned later -->
                            {{ inc.address || '—' }}
                            <button
                                v-if='!slRelocating'
                                class='btn btn-link btn-sm p-0 ms-1 text-decoration-none'
                                data-test='change-location'
                                @click='slRelocateError = ""; slRelocating = true'
                            >
                                Change
                            </button>
                        </div>
                        <div class='col-4 text-muted'>
                            Coords
                        </div>
                        <div
                            class='col-8 font-monospace text-muted'
                            style='font-size:11px'
                        >
                            {{ (inc.lat ?? 0).toFixed(6) }}, {{ (inc.lon ?? 0).toFixed(6) }}
                        </div>
                        <div class='col-4 text-muted'>
                            Dispatcher
                        </div>
                        <div class='col-8'>
                            {{ inc.dispatcher || '—' }}
                        </div>
                        <!-- Employee numbers (Dispatcher Settings → Employee Numbers on). Who created
                             the incident is kept for the report and CSV; who took each call is on the caller. -->
                        <template v-if='dispatcherStore.operatorNumbers'>
                            <div class='col-4 text-muted'>
                                Initial Dispatcher #
                            </div>
                            <div class='col-8'>
                                {{ inc.initial_dispatcher_no || '—' }}
                            </div>
                        </template>
                        <div class='col-4 text-muted'>
                            Report #
                        </div>
                        <div class='col-8'>
                            <!-- Editable whether active or closed: report numbers often arrive after close -->
                            <div
                                v-if='slReportEditing'
                                class='d-flex gap-1'
                            >
                                <input
                                    v-model='slReportInput'
                                    type='text'
                                    maxlength='64'
                                    class='form-control form-control-sm border'
                                    placeholder='Report number'
                                    @keydown.enter='slSaveReportNumber(inc)'
                                    @keydown.esc='slReportEditing = false'
                                >
                                <button
                                    class='btn btn-sm btn-outline-secondary'
                                    :disabled='slSaving'
                                    @click='slSaveReportNumber(inc)'
                                >
                                    Save
                                </button>
                            </div>
                            <template v-else>
                                {{ inc.report_number || '—' }}
                                <button
                                    class='btn btn-link btn-sm p-0 ms-1 text-decoration-none'
                                    @click='slStartReportEdit(inc)'
                                >
                                    {{ inc.report_number ? 'Edit' : 'Add' }}
                                </button>
                            </template>
                        </div>
                        <template v-if='inc.status === "closed"'>
                            <div class='col-4 text-muted'>
                                Disposition
                            </div>
                            <div class='col-8'>
                                {{ dispositionLabel(inc) || '—' }}
                            </div>
                            <template v-if='dispatcherStore.operatorNumbers'>
                                <div class='col-4 text-muted'>
                                    Closed by #
                                </div>
                                <div class='col-8'>
                                    {{ inc.closed_by_no || '—' }}
                                </div>
                            </template>
                        </template>
                        <template v-if='inc.details'>
                            <div class='col-4 text-muted'>
                                Details
                            </div>
                            <div
                                class='col-8'
                                style='white-space:pre-wrap'
                            >
                                {{ inc.details }}
                            </div>
                        </template>
                    </div>
                </div>
            </div>
            <!-- Change location: the New Incident form's Location block on its own, filled with where the
                 incident is now. Saving moves the marker and writes both places to the notes. -->
            <div
                v-if='slRelocating'
                class='border rounded p-2'
                data-test='relocate'
            >
                <IncidentForm
                    server-mode='standalone'
                    :incident-types='[]'
                    :relocate='inc'
                    @relocated='slSaveLocation(inc, $event)'
                    @cancel='slRelocating = false'
                />
                <div
                    v-if='slRelocateError'
                    class='alert alert-danger py-2 small mt-2 mb-0'
                >
                    {{ slRelocateError }}
                </div>
            </div>
            <!-- Callers: every call about this incident, in the order received. The primary
                 caller's number is the marker's tap-to-call number. Editable on active or closed incidents. -->
            <div class='border-top pt-2 mt-2'>
                <div class='d-flex align-items-center mb-1'>
                    <div class='small text-muted flex-grow-1'>
                        Callers
                    </div>
                    <button
                        v-if='slCallerForm === null'
                        class='btn btn-link btn-sm p-0 text-decoration-none'
                        data-test='add-caller'
                        @click='slStartAddCaller()'
                    >
                        + Add caller
                    </button>
                </div>
                <div
                    v-for='c in (inc.callers ?? [])'
                    :key='c.id'
                    class='small py-1 border-bottom'
                    data-test='caller-row'
                >
                    <div class='d-flex gap-1'>
                        <span class='text-muted text-nowrap'>{{ callTime(c.time) }}</span>
                        <span class='flex-grow-1 text-break'>
                            {{ c.name || '' }}
                            <a
                                v-if='c.phone && slDialable(c.phone)'
                                :href='`tel:${slDialable(c.phone)}`'
                            >{{ c.phone }}</a>
                            <template v-else>{{ c.phone || '' }}</template>
                        </span>
                    </div>
                    <div
                        v-if='c.note'
                        class='text-muted fst-italic'
                    >
                        {{ c.note }}
                    </div>
                    <div class='d-flex align-items-center justify-content-end gap-2'>
                        <!-- Who took this call (Employee Numbers on); left side, actions stay right -->
                        <span
                            v-if='c.taken_by && dispatcherStore.operatorNumbers'
                            class='text-muted me-auto'
                            title='Employee number of who took this call'
                        >Taken by #{{ c.taken_by }}</span>
                        <span
                            v-if='c.primary'
                            class='badge bg-primary text-white'
                            title='Its number is the tap-to-call number on the incident marker'
                        >Primary</span>
                        <button
                            v-else
                            class='btn btn-link btn-sm p-0 text-decoration-none'
                            :disabled='slSaving'
                            title='Use this number for tap-to-call on the marker'
                            @click='slMakePrimary(inc, c)'
                        >
                            Make primary
                        </button>
                        <button
                            class='btn btn-link btn-sm p-0 text-decoration-none'
                            :disabled='slSaving'
                            @click='slStartEditCaller(c)'
                        >
                            Edit
                        </button>
                        <button
                            class='btn btn-link btn-sm p-0 text-danger text-decoration-none'
                            :disabled='slSaving'
                            title='Remove caller'
                            aria-label='Remove caller'
                            @click='slRemovingCaller = c.id'
                        >
                            <IconTrash
                                :size='16'
                                stroke='1'
                            />
                        </button>
                    </div>
                    <!-- Remove asks here, in the row, so the question shows in whichever window the incident is in -->
                    <div
                        v-if='slRemovingCaller === c.id'
                        class='d-flex align-items-center gap-2 mt-1'
                        data-test='remove-caller-confirm'
                    >
                        <span class='text-danger me-auto'>Remove this caller from the incident record?</span>
                        <button
                            class='btn btn-sm btn-danger'
                            :disabled='slSaving'
                            @click='slRemoveCaller(inc, c)'
                        >
                            Remove
                        </button>
                        <button
                            class='btn btn-sm btn-secondary'
                            @click='slRemovingCaller = null'
                        >
                            Cancel
                        </button>
                    </div>
                </div>
                <div
                    v-if='!(inc.callers ?? []).length && slCallerForm === null'
                    class='text-muted small py-1'
                >
                    No callers recorded
                </div>

                <!-- Add / edit one caller -->
                <div
                    v-if='slCallerForm !== null'
                    class='d-flex flex-column gap-1 mt-2'
                >
                    <div class='small text-muted'>
                        {{ slCallerForm === 'new' ? 'Add caller' : 'Edit caller' }}
                    </div>
                    <input
                        v-model='slCallerName'
                        type='text'
                        maxlength='120'
                        class='form-control form-control-sm border'
                        placeholder='Caller name'
                        @keydown.esc='slCallerForm = null'
                    >
                    <input
                        v-model='slCallerPhone'
                        type='tel'
                        maxlength='40'
                        class='form-control form-control-sm border'
                        placeholder='Phone number'
                        @keydown.esc='slCallerForm = null'
                    >
                    <input
                        v-model='slCallerNote'
                        type='text'
                        maxlength='200'
                        class='form-control form-control-sm border'
                        placeholder='Note (optional), e.g. reports smoke from rear'
                        @keydown.esc='slCallerForm = null'
                    >
                    <label class='small text-muted mb-0'>
                        Time of call
                        <input
                            v-model='slCallerTime'
                            type='datetime-local'
                            class='form-control form-control-sm border'
                            @keydown.enter='slSaveCallerForm(inc)'
                            @keydown.esc='slCallerForm = null'
                        >
                    </label>
                    <div class='d-flex gap-1'>
                        <button
                            class='btn btn-sm btn-outline-secondary'
                            :disabled='slSaving'
                            data-test='save-caller'
                            @click='slSaveCallerForm(inc)'
                        >
                            Save
                        </button>
                        <button
                            class='btn btn-sm btn-link text-muted text-decoration-none'
                            @click='slCallerForm = null'
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>

            <!-- Notes log -->
            <div
                v-if='inc.notes.length'
                class='border-top pt-2 mt-2'
            >
                <div class='small text-muted mb-1'>
                    Notes
                </div>
                <div
                    v-for='(n, i) in inc.notes'
                    :key='i'
                    class='small mb-1'
                >
                    <span class='text-muted'>{{ shortTime(n.time) }}</span>
                    {{ n.text }}
                    <span
                        v-if='n.by && dispatcherStore.operatorNumbers'
                        class='text-muted'
                        title='Employee number'
                    >· {{ n.by }}</span>
                </div>
            </div>

            <!-- Add note (active only) -->
            <div
                v-if='inc.status === "active"'
                class='d-flex gap-1 mt-2'
            >
                <input
                    v-model='slNoteInput'
                    type='text'
                    class='form-control form-control-sm border flex-grow-1'
                    placeholder='Add note…'
                    @keydown.enter='slAddNote(inc)'
                >
                <button
                    class='btn btn-sm btn-outline-secondary'
                    :disabled='!slNoteInput.trim()'
                    @click='slAddNote(inc)'
                >
                    Add
                </button>
            </div>

            <!-- Assigned Units -->
            <div class='border-top pt-2 mt-3'>
                <div class='small text-muted mb-1 fw-semibold'>
                    Assigned Units
                </div>
                <div
                    v-for='c in inc.assigned'
                    :key='`${c.uid}:${c.assigned_at ?? ""}`'
                    class='small py-1 border-bottom'
                >
                    <div class='d-flex align-items-center gap-2'>
                        <span
                            class='fw-semibold'
                            :class='unitStatus(c) === "cleared" ? "text-muted text-decoration-line-through" : ""'
                        >{{ c.callsign }}</span>
                        <span
                            class='badge'
                            :class='slUnitBadge(c)'
                        >{{ slUnitLabel(c) }}</span>
                        <span class='flex-grow-1' />
                        <button
                            v-if='inc.status === "active" && unitStatus(c) === "assigned"'
                            class='btn btn-sm btn-outline-warning py-0'
                            :disabled='slSaving'
                            @click='slSetUnitStatus(inc, c, "on_scene")'
                        >
                            On Scene
                        </button>
                        <button
                            v-if='inc.status === "active" && unitStatus(c) !== "cleared"'
                            class='btn btn-sm btn-outline-secondary py-0'
                            :disabled='slSaving'
                            @click='slSetUnitStatus(inc, c, "cleared")'
                        >
                            Clear
                        </button>
                        <button
                            v-if='inc.status === "active"'
                            class='btn btn-link btn-sm p-0 text-danger text-decoration-none'
                            title='Assigned by mistake: remove from the record'
                            aria-label='Remove unit'
                            @click='slUnassignContact(inc, c)'
                        >
                            <IconTrash
                                :size='16'
                                stroke='1'
                            />
                        </button>
                    </div>
                    <div class='text-muted'>
                        {{ unitTimesLine(c, shortTime) }}
                    </div>
                </div>
                <div
                    v-if='!inc.assigned.length'
                    class='text-muted small py-1'
                >
                    No units assigned
                </div>

                <!-- Assign: free-text search + contacts picker button (active only) -->
                <template v-if='inc.status === "active"'>
                    <div class='d-flex gap-1 mt-2'>
                        <input
                            v-model='slContactSearch'
                            type='text'
                            class='form-control form-control-sm border'
                            :placeholder='loadingContacts ? "Loading contacts…" : "Search contacts to assign…"'
                            :disabled='loadingContacts'
                        >
                        <button
                            class='btn btn-sm btn-outline-secondary d-flex align-items-center'
                            :class='{ active: showContactPicker }'
                            :disabled='loadingContacts'
                            title='Pick from contacts'
                            @click='toggleContactPicker'
                        >
                            <IconUsers :size='16' />
                        </button>
                    </div>
                    <div
                        v-if='filteredContacts.length && slContactSearch'
                        class='border rounded mt-1'
                        style='max-height:120px;overflow-y:auto'
                    >
                        <!-- A unit still working another incident is greyed with that incident's number:
                             Clear it there first. -->
                        <button
                            v-for='c in filteredContacts'
                            :key='c.uid'
                            class='btn btn-sm w-100 text-start px-2 py-1 border-0 border-bottom rounded-0'
                            style='font-size:12px'
                            :disabled='slBusy.has(c.uid)'
                            :title='slBusy.has(c.uid) ? `Clear it on ${slBusy.get(c.uid)} first` : undefined'
                            @click='slAssignContact(inc, c)'
                        >
                            <template v-if='slBusy.has(c.uid)'>
                                {{ c.callsign }} · on {{ slBusy.get(c.uid) }}
                            </template>
                            <template v-else>
                                + {{ c.callsign }}
                            </template>
                        </button>
                    </div>

                    <!-- Multi-select contacts picker (mirrors CloudTAK's contacts tool) -->
                    <div
                        v-if='showContactPicker'
                        class='border rounded mt-1'
                    >
                        <div class='small text-muted px-2 py-1 border-bottom d-flex align-items-center'>
                            <span class='flex-grow-1'>Select units to assign</span>
                            <span>{{ pickerChosen.length }} selected</span>
                        </div>
                        <div style='max-height:160px;overflow-y:auto'>
                            <label
                                v-for='c in assignablePickerContacts'
                                :key='c.uid'
                                class='d-flex align-items-center gap-2 px-2 py-1 border-bottom small mb-0'
                                :class='{ "text-muted": slBusy.has(c.uid) }'
                                :style='{ cursor: slBusy.has(c.uid) ? "default" : "pointer" }'
                                :title='slBusy.has(c.uid) ? `Clear it on ${slBusy.get(c.uid)} first` : undefined'
                            >
                                <input
                                    type='checkbox'
                                    class='form-check-input mt-0'
                                    :checked='pickerChosen.includes(c.uid)'
                                    :disabled='slBusy.has(c.uid)'
                                    @change='togglePickerContact(c.uid)'
                                >
                                <span class='flex-grow-1'>{{ c.callsign }}</span>
                                <span v-if='slBusy.has(c.uid)'>on {{ slBusy.get(c.uid) }}</span>
                            </label>
                            <div
                                v-if='!assignablePickerContacts.length'
                                class='text-muted small px-2 py-2'
                            >
                                {{ loadingContacts ? 'Loading contacts…' : 'No contacts available' }}
                            </div>
                        </div>
                        <div class='d-flex align-items-center gap-2 p-2 border-top'>
                            <button
                                class='btn btn-sm btn-link text-muted p-0 text-decoration-none'
                                @click='showContactPicker = false'
                            >
                                Cancel
                            </button>
                            <button
                                class='btn btn-sm btn-primary ms-auto'
                                :disabled='!pickerChosen.length'
                                @click='slAssignSelected(inc)'
                            >
                                Assign {{ pickerChosen.length || '' }} selected
                            </button>
                        </div>
                    </div>
                </template>
            </div>

            <div
                v-if='slDetailError'
                class='alert alert-danger py-2 small'
            >
                {{ slDetailError }}
            </div>
            <!-- Close chooser: how did the call end? Pick a disposition (it highlights); Other
                 enables the text box beside it; Close Incident lights up once the pick is complete.
                 The server refuses a close without a disposition. -->
            <div
                v-if='slClosing && inc.status === "active"'
                ref='slCloseBox'
                class='card border border-warning'
            >
                <div class='card-body py-2 px-3 small d-flex flex-column gap-2'>
                    <div class='d-flex align-items-center'>
                        <span class='fw-semibold'>Disposition</span>
                        <button
                            class='btn btn-link btn-sm p-0 ms-auto text-decoration-none'
                            :disabled='slSaving'
                            @click='slCancelClose'
                        >
                            Cancel
                        </button>
                    </div>
                    <div class='d-flex flex-wrap gap-1'>
                        <button
                            v-for='d in DISPOSITIONS'
                            :key='d'
                            class='btn btn-sm'
                            :class='slDisposition === d ? "btn-warning" : "btn-outline-warning"'
                            :disabled='slSaving'
                            @click='slPickDisposition(d)'
                        >
                            {{ d }}
                        </button>
                    </div>
                    <div class='d-flex gap-1'>
                        <button
                            class='btn btn-sm text-nowrap'
                            :class='slDisposition === DISPOSITION_OTHER ? "btn-warning" : "btn-outline-warning"'
                            :disabled='slSaving'
                            @click='slPickDisposition(DISPOSITION_OTHER)'
                        >
                            {{ DISPOSITION_OTHER }}
                        </button>
                        <input
                            ref='slOtherInput'
                            v-model='slOtherNote'
                            type='text'
                            :maxlength='DISPOSITION_NOTE_MAX'
                            class='form-control form-control-sm border'
                            :class='slDisposition === DISPOSITION_OTHER ? "border-warning" : ""'
                            :disabled='slSaving || slDisposition !== DISPOSITION_OTHER'
                            placeholder='Enter disposition'
                            @keydown.enter='slCanClose && slCloseIncident(inc, slDisposition, slOtherNote)'
                            @keydown.esc='slCancelClose'
                        >
                    </div>
                    <div class='d-flex'>
                        <button
                            class='btn btn-sm ms-auto'
                            :class='slCanClose ? "btn-warning" : "btn-outline-secondary"'
                            :disabled='slSaving || !slCanClose'
                            @click='slCloseIncident(inc, slDisposition, slOtherNote)'
                        >
                            Close Incident
                        </button>
                    </div>
                </div>
            </div>
            <!-- Reopen: why is it coming back? The reason is required and goes in the notes as
                 "Reopened: <reason>" (with the employee number when Employee Numbers is on). -->
            <div
                v-if='slReopening && inc.status === "closed"'
                class='card border border-warning'
                data-test='reopen-card'
            >
                <div class='card-body py-2 px-3 small d-flex flex-column gap-2'>
                    <div class='d-flex align-items-center'>
                        <span class='fw-semibold'>Reason for reopening</span>
                        <button
                            class='btn btn-link btn-sm p-0 ms-auto text-decoration-none'
                            :disabled='slSaving'
                            @click='slCancelReopen'
                        >
                            Cancel
                        </button>
                    </div>
                    <input
                        ref='slReopenInput'
                        v-model='slReopenReason'
                        type='text'
                        :maxlength='REOPEN_REASON_MAX'
                        class='form-control form-control-sm border border-warning'
                        placeholder='Why is it being reopened?'
                        :disabled='slSaving'
                        @keydown.enter='slReopenReason.trim() && slReopenIncident(inc, slReopenReason)'
                        @keydown.esc='slCancelReopen'
                    >
                    <div class='d-flex'>
                        <button
                            class='btn btn-sm ms-auto'
                            :class='slReopenReason.trim() ? "btn-warning" : "btn-outline-secondary"'
                            :disabled='slSaving || !slReopenReason.trim()'
                            @click='slReopenIncident(inc, slReopenReason)'
                        >
                            Reopen Incident
                        </button>
                    </div>
                </div>
            </div>
            <div class='d-flex gap-2 mt-2'>
                <button
                    class='btn btn-sm btn-outline-secondary'
                    @click='flyToIncident(inc)'
                >
                    Show on Map
                </button>
                <button
                    v-if='inc.status === "active" && !slClosing'
                    class='btn btn-sm btn-warning ms-auto'
                    :disabled='slSaving'
                    @click='slStartClose'
                >
                    Close Incident
                </button>
                <button
                    v-else-if='inc.status === "closed" && !slReopening'
                    class='btn btn-sm btn-outline-warning ms-auto'
                    :disabled='slSaving'
                    @click='slStartReopen'
                >
                    Reopen
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
// One incident's detail: info card, callers, notes, units, close/reopen. Used by the menu
// panel (IncidentListView) and by every undocked floating card (IncidentFloat). It reads the
// incident from dispatcherStore.incidents by id, so the shared poll keeps every copy current,
// and every edit goes through the same server calls whichever copy made it.
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { IconUsers, IconPictureInPictureOn, IconTrash } from '@tabler/icons-vue';
import { useMapStore } from '../../../src/stores/map.ts';
import { postMissionLog } from '../lib/takcad-client.ts';
import { dialablePhone as slDialable } from '../lib/map-marker.ts';
import { showIncident, closeIncidentInField } from '../lib/field-delivery.ts';
import { sendAssignmentMessage, sendUpdateMessage } from '../lib/contacts-client.ts';
import type { TakContact } from '../lib/contacts-client.ts';
import { formatTime } from '../lib/takcad-types.ts';
import { patchIncident, addCaller, updateCaller, removeCaller, assignUnits, setUnitStatus, removeUnit } from '../lib/events-client.ts';
import type { DispatcherEvent, DispatcherIncident, AssignedContact, IncidentCaller } from '../lib/events-client.ts';
import { dispatcherStore } from '../lib/dispatcher-store.ts';
import { refreshSharedSettings, fetchContactsShared, loadIncidents } from '../lib/incident-poll.ts';
import { stashDraft, takeDraft } from '../lib/undock-panes.ts';
import { ASSIGN_REFUSAL_MS, isBusyRefusal, makeFlash } from '../lib/assign-refusal.ts';
import type { Draft } from '../lib/undock.ts';
import { revealInScrollBox } from '../lib/reveal.ts';
import IncidentForm from './IncidentForm.vue';
import { BOARD_LABEL, boardState, boardBadgeClass, busyUnits, respondingLine, unitStatus, unitTimesLine, workingUids } from '../lib/unit-status.ts';
import { DISPOSITIONS, DISPOSITION_OTHER, DISPOSITION_NOTE_MAX, REOPEN_REASON_MAX, dispositionLabel } from '../lib/dispositions.ts';

const props = defineProps<{
    incidentId: string;
    // True inside an undocked floating card (no Back/Undock header of its own).
    floating?:  boolean;
}>();

const emit = defineEmits<{
    (e: 'back'):     void;
    (e: 'undock'):   void;
    (e: 'closed'):   void;
    (e: 'reopened'): void;
}>();

const mapStore = useMapStore();

// Live view of the incident: the poll replaces dispatcherStore.incidents, this follows it.
const inc = computed<DispatcherIncident | null>(() =>
    dispatcherStore.incidents.find(i => i.id === props.incidentId) ?? null);

// The incident already has its own window (a pane or a workspace card): Undock is grayed out.
const alreadyUndocked = computed(() => dispatcherStore.undocked.includes(props.incidentId));

const slNoteInput       = ref('');
const slReportEditing   = ref(false);
const slReportInput     = ref('');
// Change location: the editor is open under the facts; its own error line, since the shared one is far below.
const slRelocating      = ref(false);
const slRelocateError   = ref('');
// Close chooser: open after the first press of Close Incident. The dispatcher picks a disposition
// (highlighted), types the Other text when that is the pick, then presses Close Incident.
const slClosing         = ref(false);
const slDisposition     = ref<string | null>(null);
const slOtherNote       = ref('');
const slOtherInput      = ref<HTMLInputElement | null>(null);
const slCloseBox        = ref<HTMLElement | null>(null);
// Reopen box: open after pressing Reopen on a closed incident; Reopen Incident needs a reason.
const slReopening       = ref(false);
const slReopenReason    = ref('');
const slReopenInput     = ref<HTMLInputElement | null>(null);
// Close Incident lights up once the pick is complete: a preset, or Other with its text.
const slCanClose = computed(() =>
    !!slDisposition.value && (slDisposition.value !== DISPOSITION_OTHER || slOtherNote.value.trim().length > 0));
// Caller form: null = closed, 'new' = adding a caller, otherwise the id of the caller being edited.
const slCallerForm      = ref<string | null>(null);
const slCallerName      = ref('');
const slCallerPhone     = ref('');
const slCallerNote      = ref('');
const slCallerTime      = ref('');
const slContactSearch   = ref('');
const slSaving          = ref(false);
const slDetailError     = ref('');
const allContacts       = ref<TakContact[]>([]);
const loadingContacts   = ref(false);
const showContactPicker = ref(false);
const pickerSelected    = ref<string[]>([]);

// One incident per unit: units still working another active incident of this Event, uid -> its
// short number. They stay in the lists, greyed and not selectable, below the free ones.
const slBusy = computed(() => busyUnits(dispatcherStore.incidents, inc.value?.id));
const freeFirst = (list: TakContact[]) =>
    [...list].sort((a, b) => Number(slBusy.value.has(a.uid)) - Number(slBusy.value.has(b.uid)));

const filteredContacts = computed(() => {
    const q = slContactSearch.value.toLowerCase();
    const assigned = workingUids(inc.value?.assigned);
    return freeFirst(allContacts.value.filter(c =>
        !assigned.has(c.uid) &&
        (!q || c.callsign.toLowerCase().includes(q))
    ));
});

// Contacts not yet assigned — the multi-select picker's candidate list.
const assignablePickerContacts = computed(() => {
    const assigned = workingUids(inc.value?.assigned);
    return freeFirst(allContacts.value.filter(c => !assigned.has(c.uid)));
});

// The picks that will be sent: a unit that became busy after it was ticked drops out.
const pickerChosen = computed(() => pickerSelected.value.filter(uid => !slBusy.value.has(uid)));

function shortTime(iso: string): string {
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
}

// Refetch the live contacts list (keeps the previous list on failure). Called whenever
// the dispatcher opens an incident or the picker, so users who connected after the panel
// loaded show up without a reload.
async function loadContacts() {
    loadingContacts.value = true;
    try { allContacts.value = await fetchContactsShared(); }
    catch { /* keep previous list */ }
    finally { loadingContacts.value = false; }
}

async function toggleContactPicker() {
    showContactPicker.value = !showContactPicker.value;
    pickerSelected.value = [];
    if (showContactPicker.value) await loadContacts();
}

function togglePickerContact(uid: string) {
    const i = pickerSelected.value.indexOf(uid);
    if (i === -1) pickerSelected.value.push(uid);
    else pickerSelected.value.splice(i, 1);
}

async function slAssignSelected(inc: DispatcherIncident) {
    const chosen = allContacts.value.filter(c => pickerChosen.value.includes(c.uid));
    pickerSelected.value = [];
    showContactPicker.value = false;
    if (!chosen.length) return;

    // Use the freshest incident state (the passed `inc` can be a stale snapshot), and assign
    // ALL selected in ONE call.
    const cur = dispatcherStore.incidents.find(i => i.id === inc.id) ?? inc;
    const existing = cur.assigned ?? [];
    const working = workingUids(existing);
    const toAdd = chosen.filter(c => !working.has(c.uid));
    if (!toAdd.length) return;

    slDetailError.value = '';
    try {
        // The server stamps the time and writes the "assigned" notes.
        const updated = await assignUnits(inc.id, toAdd.map(c => ({ uid: c.uid, callsign: c.callsign })));
        slApplyIncident(updated);

        // One GeoChat per newly-assigned responder
        for (const c of toAdd) {
            try { await sendAssignmentMessage(mapStore, c, { name: `${updated.number} ${updated.type ?? ''}`, address: updated.address ?? '' }); }
            catch (e) { console.warn('[dispatcher] assignment message failed', e); }
        }
        // Update the marker remarks once with the full responder list
        try { await showIncident(mapStore, slMarkerFor(updated)); }
        catch { /* best-effort */ }
        const feed = slEventFor(updated);
        if (feed) {
            for (const c of toAdd) {
                try { await postMissionLog(feed.feed_name, `ASSIGNED: ${updated.number} → ${c.callsign}`); }
                catch { /* best-effort */ }
            }
        }
    } catch (e) {
        // Nothing was assigned (e.g. another dispatcher just put one of them on another incident).
        // Re-read the board so that unit greys out, and give the picks back to press Assign again.
        slAssignFailed(e);
        await loadIncidents();
        pickerSelected.value = toAdd.map(c => c.uid);
        showContactPicker.value = true;
    }
}

// Build the marker payload for an incident, folding responders + notes into the remarks
// details (same presentation as before, now sourced from server fields).
function slMarkerFor(inc: DispatcherIncident, extraDetail = '') {
    const ev = slEventFor(inc);
    const details = [
        inc.details ?? '',
        respondingLine(inc.assigned),
        ...(inc.notes ?? []).map(n => n.text),
        extraDetail,
    ].filter(Boolean).join('\n');
    return {
        uid:        inc.id,
        number:     inc.number,
        name:       inc.type ?? '',
        type:       inc.type ?? '',
        address:    inc.address ?? '',
        lat:        inc.lat ?? 0,
        lon:        inc.lon ?? 0,
        time:       inc.created_at,
        dispatcher: inc.dispatcher ?? '',
        details,
        // Callers reach the marker only through this list. Off means nothing about callers goes out.
        callers:    dispatcherStore.callerOnMarkers ? (inc.callers ?? []) : [],
        feedGuid:   ev?.feed_guid,
        delivery:    ev?.delivery,
        channel:     ev?.channel,
        coreEventId: inc.core_event_id,
        closedAt:    inc.closed_at,
    };
}

// Merge a server-returned incident back into the shared store (every open copy follows). A reply that lands
// after the dispatcher switched to another Event is not put on that Event's board; the rest of the save (unit
// messages, this incident's marker and feed log, which go to its own Event) still happens.
function slApplyIncident(updated: DispatcherIncident) {
    if (updated.event_id !== dispatcherStore.activeEvent?.id) return;
    const idx = dispatcherStore.incidents.findIndex(i => i.id === updated.id);
    if (idx !== -1) dispatcherStore.incidents[idx] = updated;
    else dispatcherStore.incidents.push(updated);
}

// The Event this incident belongs to, for its marker and its feed log. Remembered while it is open, so a save
// that finishes after the dispatcher switched Events still goes to this incident's own Event, never the new one.
let slOwnEvent: DispatcherEvent | null = null;
watch(() => dispatcherStore.activeEvent, (ev) => {
    if (ev && ev.id === inc.value?.event_id) slOwnEvent = ev;
}, { immediate: true });
function slEventFor(i: DispatcherIncident): DispatcherEvent | null {
    const ev = dispatcherStore.activeEvent;
    if (ev && ev.id === i.event_id) slOwnEvent = ev;
    return slOwnEvent?.id === i.event_id ? slOwnEvent : null;
}

async function slAssignContact(inc: DispatcherIncident, contact: TakContact) {
    if (workingUids(inc.assigned).has(contact.uid) || slBusy.value.has(contact.uid)) return;
    // Cleared at once (a second click can't send it twice), put back if the assignment fails.
    const typed = slContactSearch.value;
    slContactSearch.value = '';
    slDetailError.value = '';

    try {
        const updated = await assignUnits(inc.id, [{ uid: contact.uid, callsign: contact.callsign }]);
        slApplyIncident(updated);

        // GeoChat assignment message
        try {
            await sendAssignmentMessage(mapStore, contact, { name: `${updated.number} ${updated.type ?? ''}`, address: updated.address ?? '' });
        } catch (e) { console.warn('[dispatcher] assignment message failed', e); }

        // Update CoT marker remarks with responders
        try { await showIncident(mapStore, slMarkerFor(updated)); }
        catch { /* best-effort */ }

        // DataSync log
        const feed = slEventFor(updated);
        if (feed) {
            try { await postMissionLog(feed.feed_name, `ASSIGNED: ${updated.number} → ${contact.callsign}`); }
            catch { /* best-effort */ }
        }
    } catch (e) {
        slAssignFailed(e);
        slContactSearch.value = typed;  // the list again, with the unit greyed where it is busy
        await loadIncidents();  // a refusal: the unit greys out with the incident it is on
    }
}

// A failed assignment. The server's "unit is busy" refusal (`E12 is on 014. Clear it there first.`)
// shows for 10 s, then goes; the greyed unit keeps saying where it is. Any other failure (network,
// a closed incident) stays until the next action, so a unit that never went out is not missed.
const slRefusal = makeFlash(() => slDetailError.value, (text) => { slDetailError.value = text; }, ASSIGN_REFUSAL_MS);
function slAssignFailed(e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isBusyRefusal(e)) slRefusal.show(msg);
    else slDetailError.value = msg;
}
onBeforeUnmount(() => slRefusal.stop());

// Report number: the server logs every change as a timestamped note, so only the
// field itself is sent (no read-modify-write of the notes array from the browser).
function slStartReportEdit(inc: DispatcherIncident) {
    slReportInput.value = inc.report_number ?? '';
    slReportEditing.value = true;
}

async function slSaveReportNumber(inc: DispatcherIncident) {
    if (slSaving.value) return;  // Enter can fire again while the first save is in flight
    const value = slReportInput.value.trim();
    if (value === (inc.report_number ?? '')) { slReportEditing.value = false; return; }
    slSaving.value = true; slDetailError.value = '';
    try {
        const updated = await patchIncident(inc.id, { report_number: value });
        slApplyIncident(updated);
        slReportEditing.value = false;
    } catch (e) {
        slDetailError.value = e instanceof Error ? e.message : String(e);
    } finally {
        slSaving.value = false;
    }
}

// Change of location. Only the new place is sent: the server writes the note with both places
// (<location-pure> in the server file), so the log shows where the incident started and where it
// moved to. Then the marker moves, the feed log says so, and the units on the incident are told.
async function slSaveLocation(inc: DispatcherIncident, to: { address: string; lat: number; lon: number }) {
    if (slSaving.value) return;
    const sameSpot = (was: number | null, now: number) => was != null && was.toFixed(6) === now.toFixed(6);
    if (to.address === (inc.address ?? '') && sameSpot(inc.lat, to.lat) && sameSpot(inc.lon, to.lon)) {
        slRelocating.value = false;
        return;
    }
    slSaving.value = true; slRelocateError.value = '';
    try {
        const updated = await patchIncident(inc.id, { address: to.address, lat: to.lat, lon: to.lon });
        slApplyIncident(updated);
        slRelocating.value = false;

        // An open incident's marker moves. A closed one has none in a DataSync Event; in a broadcast
        // Event its CLOSED marker moves and still drops off when it was going to.
        const marker = slMarkerFor(updated);
        try { await (updated.status === 'active' ? showIncident(mapStore, marker) : closeIncidentInField(mapStore, marker)); }
        catch { /* best-effort */ }

        const where = updated.address || `${to.lat.toFixed(6)}, ${to.lon.toFixed(6)}`;
        const feed = slEventFor(updated);
        if (feed) {
            try { await postMissionLog(feed.feed_name, `LOCATION CHANGED: ${updated.number} | ${where}`); }
            catch { /* best-effort */ }
        }
        for (const c of (updated.assigned ?? []).filter(u => unitStatus(u) !== 'cleared')) {
            try { await sendUpdateMessage(mapStore, c, { name: `${updated.number} ${updated.type ?? ''}` }, `Location changed to ${where}`); }
            catch (e) { console.warn('[dispatcher] update message failed', e); }
        }
    } catch (e) {
        slRelocateError.value = e instanceof Error ? e.message : String(e);
    } finally {
        slSaving.value = false;
    }
}

// Callers: each add / edit / make-primary / remove is one server call that locks the incident row,
// so dispatchers working the same incident can't overwrite each other's callers. Callers are not
// logged to the notes; the list (with each call's time) is the record. The marker is resent so
// field units see the change (closed incidents have no marker to resend).
function callTime(iso: string): string {
    try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
}

// <input type=datetime-local> wants local "YYYY-MM-DDTHH:mm".
function toLocalInput(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function slStartAddCaller() {
    slCallerName.value = '';
    slCallerPhone.value = '';
    slCallerNote.value = '';
    slCallerTime.value = toLocalInput(new Date());
    slCallerForm.value = 'new';
}

function slStartEditCaller(c: IncidentCaller) {
    slCallerName.value = c.name ?? '';
    slCallerPhone.value = c.phone ?? '';
    slCallerNote.value = c.note ?? '';
    slCallerTime.value = toLocalInput(new Date(c.time));
    slCallerForm.value = c.id;
}

async function slCallerChange(op: () => Promise<DispatcherIncident>): Promise<boolean> {
    if (slSaving.value) return false;  // Enter can fire again while a save is in flight
    slSaving.value = true; slDetailError.value = '';
    try {
        const updated = await op();
        slApplyIncident(updated);
        if (updated.status === 'active') {
            try { await showIncident(mapStore, slMarkerFor(updated)); }
            catch { /* best-effort */ }
        }
        return true;
    } catch (e) {
        slDetailError.value = e instanceof Error ? e.message : String(e);
        return false;
    } finally {
        slSaving.value = false;
    }
}

async function slSaveCallerForm(inc: DispatcherIncident) {
    const target = slCallerForm.value;
    if (!target) return;
    const when = slCallerTime.value ? new Date(slCallerTime.value) : null;
    if (when && Number.isNaN(when.getTime())) { slDetailError.value = 'Time of call is not a valid date'; return; }
    const body = {
        name:  slCallerName.value.trim(),
        phone: slCallerPhone.value.trim(),
        note:  slCallerNote.value.trim(),
        ...(when ? { time: when.toISOString() } : {}),
    };
    if (!body.name && !body.phone) {
        slDetailError.value = 'Enter a caller name or phone number';
        return;
    }
    const ok = await slCallerChange(() => (target === 'new'
        ? addCaller(inc.id, body)
        : updateCaller(inc.id, target, body)));
    if (ok) slCallerForm.value = null;
}

async function slMakePrimary(inc: DispatcherIncident, c: IncidentCaller) {
    await slCallerChange(() => updateCaller(inc.id, c.id, { primary: true }));
}

// Remove asks first, in the caller's row (slRemovingCaller), not in a browser dialog: a Multi-Monitor card
// is in another window, and the question must show where the dispatcher is looking.
const slRemovingCaller = ref<string | null>(null);

async function slRemoveCaller(inc: DispatcherIncident, c: IncidentCaller) {
    if (slCallerForm.value === c.id) slCallerForm.value = null;
    if (await slCallerChange(() => removeCaller(inc.id, c.id))) slRemovingCaller.value = null;
}

// One row (one trip) of the unit leaves the record.
async function slUnassignContact(inc: DispatcherIncident, contact: AssignedContact) {
    slDetailError.value = '';

    try {
        const updated = await removeUnit(inc.id, contact.uid, contact.assigned_at);
        slApplyIncident(updated);

        const feed = slEventFor(updated);
        if (feed) {
            try { await postMissionLog(feed.feed_name, `UNASSIGNED: ${updated.number} → ${contact.callsign}`); }
            catch { /* best-effort */ }
        }

        try { await showIncident(mapStore, slMarkerFor(updated)); }
        catch { /* best-effort */ }
    } catch (e) {
        slDetailError.value = e instanceof Error ? e.message : String(e);
    }
}

// On Scene / Clear buttons. The server stamps the time; nothing goes to the unit (it just radioed dispatch).
async function slSetUnitStatus(inc: DispatcherIncident, unit: AssignedContact, to: 'on_scene' | 'cleared') {
    if (slSaving.value) return;
    slSaving.value = true; slDetailError.value = '';
    try {
        const updated = await setUnitStatus(inc.id, unit.uid, to);
        slApplyIncident(updated);

        try { await showIncident(mapStore, slMarkerFor(updated)); }
        catch { /* best-effort */ }

        const feed = slEventFor(updated);
        if (feed) {
            try { await postMissionLog(feed.feed_name, `${to === 'on_scene' ? 'ON SCENE' : 'CLEARED'}: ${updated.number} → ${unit.callsign}`); }
            catch { /* best-effort */ }
        }
    } catch (e) {
        slDetailError.value = e instanceof Error ? e.message : String(e);
    } finally {
        slSaving.value = false;
    }
}

function slUnitLabel(u: AssignedContact): string {
    const s = unitStatus(u);
    return s === 'on_scene' ? 'On Scene' : s === 'cleared' ? 'Cleared' : 'Assigned';
}

function slUnitBadge(u: AssignedContact): string {
    const s = unitStatus(u);
    return s === 'on_scene' ? 'bg-warning text-dark' : s === 'cleared' ? 'bg-secondary text-white' : 'bg-info text-dark';
}

async function slAddNote(inc: DispatcherIncident) {
    const text = slNoteInput.value.trim();
    if (!text) return;
    const notes = [...(inc.notes ?? []), { text, time: new Date().toISOString() }];
    slNoteInput.value = '';
    slDetailError.value = '';

    try {
        const updated = await patchIncident(inc.id, { notes });
        slApplyIncident(updated);

        // Update CoT marker with latest notes appended to details
        try { await showIncident(mapStore, slMarkerFor(updated)); }
        catch { /* best-effort */ }

        // DataSync log entry
        const feed = slEventFor(updated);
        if (feed) {
            try { await postMissionLog(feed.feed_name, `UPDATE ${updated.number}: ${text}`); }
            catch { /* best-effort */ }
        }

        // Push the update to every assigned responder as a direct GeoChat
        for (const c of (updated.assigned ?? []).filter(u => unitStatus(u) !== 'cleared')) {
            try { await sendUpdateMessage(mapStore, c, { name: `${updated.number} ${updated.type ?? ''}` }, text); }
            catch (e) { console.warn('[dispatcher] update message failed', e); }
        }
    } catch (e) {
        slDetailError.value = e instanceof Error ? e.message : String(e);
    }
}

function slStartClose() {
    slClosing.value = true;
    // The chooser opens at the bottom of a long panel: scroll so every disposition and its Close Incident show.
    nextTick(() => revealInScrollBox(slCloseBox.value));
}

function slPickDisposition(d: string) {
    slDisposition.value = d;
    // Other: the text box beside it takes the cursor so the dispatcher can type at once.
    if (d === DISPOSITION_OTHER) nextTick(() => slOtherInput.value?.focus());
}

function slCancelClose() {
    slClosing.value = false;
    slDisposition.value = null;
    slOtherNote.value = '';
}

function slStartReopen() {
    // Employee Numbers off: reopen right away, as it always did (no reason box).
    if (!dispatcherStore.operatorNumbers) {
        if (inc.value) void slReopenIncident(inc.value, '');
        return;
    }
    slReopening.value = true;
    slReopenReason.value = '';
    // The box sits at the bottom of a long panel: bring it into view, not just focus it.
    nextTick(() => {
        revealInScrollBox(slReopenInput.value, 'center');
        slReopenInput.value?.focus({ preventScroll: true });
    });
}

function slCancelReopen() {
    slReopening.value = false;
    slReopenReason.value = '';
}

// disposition: one of DISPOSITIONS, or DISPOSITION_OTHER with `note` (the text typed beside it).
async function slCloseIncident(inc: DispatcherIncident, disposition: string | null, note?: string) {
    if (!disposition) return;
    slSaving.value = true; slDetailError.value = '';
    try {
        const stillOn = (inc.assigned ?? []).filter(u => unitStatus(u) !== 'cleared');
        // The server stores the disposition, writes the "Closed: …" note and clears every unit
        // still on the incident (stamped with the close time).
        const trimmed = (note ?? '').trim();
        const updated = await patchIncident(inc.id, {
            status: 'closed',
            disposition,
            ...(trimmed ? { disposition_note: trimmed } : {}),
        });
        slApplyIncident(updated);
        slCancelClose();

        // DataSync: remove the marker (record stays server-side). Broadcast: mark it CLOSED;
        // it drops off field devices after the admin-set window (Dispatcher Settings, default 60 min).
        try { await closeIncidentInField(mapStore, slMarkerFor(updated)); }
        catch { /* best-effort */ }

        // DataSync log entry
        const feed = slEventFor(updated);
        if (feed) {
            try {
                const closedAt = new Date();
                const startMs = new Date(updated.created_at).getTime();
                const durMin = Math.round((closedAt.getTime() - startMs) / 60000);
                const hhmm = `${String(closedAt.getHours()).padStart(2, '0')}:${String(closedAt.getMinutes()).padStart(2, '0')}`;
                // Closing cleared every unit still on the incident (the server stamps the close time).
                for (const u of stillOn) {
                    try { await postMissionLog(feed.feed_name, `CLEARED: ${updated.number} → ${u.callsign}`); }
                    catch { /* best-effort */ }
                }
                await postMissionLog(feed.feed_name, `INCIDENT CLOSED: ${updated.number} | ${updated.type ?? ''} | Closed ${hhmm} | ${durMin} min | ${dispositionLabel(updated)}`);
            } catch { /* best-effort */ }
        }
        emit('closed');
    } catch (e) {
        slDetailError.value = e instanceof Error ? e.message : String(e);
    } finally {
        slSaving.value = false;
    }
}

async function slReopenIncident(inc: DispatcherIncident, reason: string) {
    const withReason = dispatcherStore.operatorNumbers;
    const why = withReason ? reason.trim() : '';
    if (withReason && !why) return;
    slSaving.value = true; slDetailError.value = '';
    try {
        // Employee Numbers on: the server requires the reason and writes the "Reopened: …" note.
        const updated = await patchIncident(inc.id, withReason ? { status: 'active', reopen_reason: why } : { status: 'active' });
        slApplyIncident(updated);
        slCancelReopen();

        // Re-drop the CoT marker to the feed (broadcast: reopen the Core Event)
        try { await showIncident(mapStore, slMarkerFor(updated)); }
        catch { /* best-effort */ }

        const feed = slEventFor(updated);
        if (feed) {
            try { await postMissionLog(feed.feed_name, `INCIDENT REOPENED: ${updated.number} | ${updated.type ?? ''}${why ? ` | ${why}` : ''}`); }
            catch { /* best-effort */ }
        }
        emit('reopened');
    } catch (e) {
        slDetailError.value = e instanceof Error ? e.message : String(e);
    } finally {
        slSaving.value = false;
    }
}

function flyToIncident(inc: DispatcherIncident) {
    mapStore.map?.flyTo({ center: [inc.lon ?? 0, inc.lat ?? 0], zoom: 15 });
}

// What the dispatcher is in the middle of, to carry into another window.
// Forms count as open only while they show (Close only on an active incident, Reopen only on a closed one).
function currentDraft(): Draft {
    const status = inc.value?.status;
    return {
        note:          slNoteInput.value,
        reportEditing: slReportEditing.value,
        reportInput:   slReportInput.value,
        closing:       slClosing.value && status === 'active',
        disposition:   slDisposition.value,
        otherNote:     slOtherNote.value,
        reopening:     slReopening.value && status === 'closed',
        reopenReason:  slReopenReason.value,
        callerForm:    slCallerForm.value,
        callerName:    slCallerName.value,
        callerPhone:   slCallerPhone.value,
        callerNote:    slCallerNote.value,
        callerTime:    slCallerTime.value,
        contactSearch: slContactSearch.value,
    };
}

// Undock: whatever the dispatcher was in the middle of goes with the incident into its window. The window is
// placed first, then handed the draft; this panel stays mounted until the next render, so its input is still here.
function undock() {
    emit('undock');
    stashDraft(props.incidentId, currentDraft());
}

function applyDraft(d: Draft) {
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    slNoteInput.value     = str(d.note);
    slReportEditing.value = d.reportEditing === true;
    slReportInput.value   = str(d.reportInput);
    slClosing.value       = d.closing === true;
    slDisposition.value   = typeof d.disposition === 'string' ? d.disposition : null;
    slOtherNote.value     = str(d.otherNote);
    slReopening.value     = d.reopening === true;
    slReopenReason.value  = str(d.reopenReason);
    slCallerForm.value    = typeof d.callerForm === 'string' ? d.callerForm : null;
    slCallerName.value    = str(d.callerName);
    slCallerPhone.value   = str(d.callerPhone);
    slCallerNote.value    = str(d.callerNote);
    slCallerTime.value    = str(d.callerTime);
    slContactSearch.value = str(d.contactSearch);
}

onMounted(async () => {
    if (props.floating) {
        const d = takeDraft(props.incidentId);
        if (d) applyDraft(d);
    } else {
        // Opening an incident in the panel re-reads the shared settings (as before). Cards skip it:
        // the poll they hold reads them once, so restoring several cards is one fetch, not one each.
        refreshSharedSettings();
    }
    await loadContacts();
});
</script>
