<template>
    <div class='d-flex flex-column h-100 overflow-hidden'>
        <!-- ── TAK-CAD mode: full server-backed UI ──────────────────────────── -->
        <template v-if='serverMode === "takcad"'>
            <!-- ── Incident List ──────────────────────────────────── -->
            <template v-if='view === "list"'>
                <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
                    <div class='d-flex rounded overflow-hidden border flex-grow-1'>
                        <button
                            v-for='t in LIST_TABS'
                            :key='t.key'
                            class='flex-fill btn btn-sm py-1 rounded-0 border-0 small'
                            :class='listTab === t.key ? "bg-primary text-white" : "text-muted"'
                            @click='listTab = t.key'
                        >
                            {{ t.label }} <span
                                class='badge'
                                :class='listTab === t.key ? "bg-warning text-dark" : "text-muted"'
                            >{{ t.key === 'active' ? activeIncidents.length : cancelledIncidents.length }}</span>
                        </button>
                    </div>
                    <button
                        class='btn btn-sm btn-warning'
                        @click='openCreate'
                    >
                        + New
                    </button>
                </div>

                <!-- Sort bar -->
                <div class='d-flex px-3 py-1 border-bottom text-muted small flex-shrink-0'>
                    <button
                        v-for='col in SORT_COLS'
                        :key='col.key'
                        class='btn btn-sm btn-link p-0 text-muted small me-3 text-decoration-none'
                        @click='toggleSort(col.key)'
                    >
                        {{ col.label }}
                        <span v-if='sortCol === col.key'>{{ sortAsc ? '↑' : '↓' }}</span>
                    </button>
                    <span
                        class='ms-auto text-muted font-monospace'
                        style='font-size:10px'
                    >{{ lastRefreshed }}</span>
                </div>

                <!-- List -->
                <div class='flex-grow-1 overflow-auto'>
                    <div
                        v-if='loading && !displayedIncidents.length'
                        class='text-center text-muted py-4 small'
                    >
                        <span class='spinner-border spinner-border-sm me-2' />Loading…
                    </div>
                    <div
                        v-else-if='loadError'
                        class='alert alert-danger m-3 py-2 small'
                    >
                        {{ loadError }}
                    </div>
                    <div
                        v-else-if='!displayedIncidents.length'
                        class='text-center text-muted py-4 small'
                    >
                        No incidents
                    </div>
                    <div
                        v-for='inc in displayedIncidents'
                        :key='inc.uid'
                        class='d-flex align-items-start px-3 py-2 border-bottom incident-row'
                        role='button'
                        @click='openDetail(inc.uid)'
                    >
                        <div class='flex-grow-1 overflow-hidden'>
                            <div class='d-flex align-items-center gap-2'>
                                <span class='fw-semibold small text-truncate'>{{ inc.incidentName }}</span>
                                <span
                                    class='badge small'
                                    :class='statusBadge(inc.status)'
                                >{{ inc.status }}</span>
                            </div>
                            <div class='small text-muted text-truncate'>
                                {{ formatAddress(inc.location) }}
                            </div>
                            <div class='d-flex gap-3 small text-muted mt-1'>
                                <span>{{ inc.incidentType ?? '—' }}</span>
                            </div>
                        </div>
                        <div class='text-end ms-2 flex-shrink-0'>
                            <div class='small text-muted'>
                                {{ shortTime(inc.incidentTime) }}
                            </div>
                        </div>
                    </div>
                </div>
            </template>

            <!-- ── Incident Detail ────────────────────────────────── -->
            <template v-else-if='view === "detail" && detailIncident'>
                <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
                    <button
                        class='btn btn-sm btn-outline-secondary'
                        @click='view = "list"'
                    >
                        ← Back
                    </button>
                    <span class='fw-semibold text-truncate flex-grow-1'>{{ detailIncident.incidentName }}</span>
                    <span
                        class='badge'
                        :class='statusBadge(detailIncident.status)'
                    >{{ detailIncident.status }}</span>
                </div>

                <div class='flex-grow-1 overflow-auto p-3 d-flex flex-column gap-3'>
                    <!-- Core info -->
                    <div class='card border'>
                        <div class='card-body py-2 px-3 d-flex flex-column gap-1 small'>
                            <div class='row g-1'>
                                <div class='col-4 text-muted'>
                                    Type
                                </div>
                                <div class='col-8'>
                                    {{ detailIncident.incidentType?.name }}
                                </div>
                                <div class='col-4 text-muted'>
                                    Time
                                </div>
                                <div class='col-8'>
                                    {{ formatTime(detailIncident.incidentTime) }}
                                </div>
                                <div class='col-4 text-muted'>
                                    Location
                                </div>
                                <div class='col-8'>
                                    {{ formatAddress(detailIncident.location) }}
                                </div>
                                <template v-if='detailIncident.location?.coords'>
                                    <div class='col-4 text-muted'>
                                        Coords
                                    </div>
                                    <div
                                        class='col-8 font-monospace text-muted'
                                        style='font-size:11px'
                                    >
                                        {{ detailIncident.location.coords.latitudeDeg.toFixed(6) }},
                                        {{ detailIncident.location.coords.longitudeDeg.toFixed(6) }}
                                    </div>
                                </template>
                                <div class='col-4 text-muted'>
                                    Dispatcher
                                </div>
                                <div class='col-8'>
                                    {{ detailIncident.dispatcher?.name || '—' }}
                                </div>
                                <template v-if='detailIncident.details'>
                                    <div class='col-4 text-muted'>
                                        Details
                                    </div>
                                    <div
                                        class='col-8'
                                        style='white-space:pre-wrap'
                                    >
                                        {{ detailIncident.details }}
                                    </div>
                                </template>
                                <template v-if='detailIncident.firstResponderArrivalTime'>
                                    <div class='col-4 text-muted'>
                                        Arrival
                                    </div>
                                    <div class='col-8'>
                                        {{ formatTime(detailIncident.firstResponderArrivalTime) }}
                                    </div>
                                </template>
                            </div>
                        </div>
                    </div>

                    <!-- Caller info -->
                    <template v-if='detailIncident.callerInfo?.length'>
                        <div class='small text-muted fw-semibold text-uppercase'>
                            Caller
                        </div>
                        <div class='card border'>
                            <div class='card-body py-2 px-3 d-flex flex-column gap-1 small'>
                                <div class='row g-1'>
                                    <div class='col-4 text-muted'>
                                        Name
                                    </div>
                                    <div class='col-8'>
                                        {{ detailIncident.callerInfo[0].name || '—' }}
                                    </div>
                                    <div class='col-4 text-muted'>
                                        Phone
                                    </div>
                                    <div class='col-8'>
                                        {{ detailIncident.callerInfo[0].phoneNumber || '—' }}
                                    </div>
                                    <div class='col-4 text-muted'>
                                        Type
                                    </div>
                                    <div class='col-8'>
                                        {{ detailIncident.callerInfo[0].callerInfoType || '—' }}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </template>

                    <!-- Responding vehicles -->
                    <div class='small text-muted fw-semibold text-uppercase d-flex align-items-center'>
                        <span class='me-auto'>Responding Vehicles ({{ detailIncident.vehiclesResponding?.length ?? 0 }})</span>
                        <button
                            class='btn btn-sm btn-outline-warning py-0 px-2'
                            @click='view = "responders"'
                        >
                            Manage
                        </button>
                    </div>
                    <div
                        v-if='detailIncident.vehiclesResponding?.length'
                        class='card border'
                    >
                        <div class='card-body py-1 px-3'>
                            <div
                                v-for='vr in detailIncident.vehiclesResponding'
                                :key='vr.vehicle.vehicleUid'
                                class='d-flex align-items-center py-1 border-bottom border small gap-2'
                            >
                                <span class=''>{{ vr.vehicle.vehicleUid }}</span>
                                <span
                                    v-if='vr.responseStatus'
                                    class='badge bg-secondary'
                                >{{ vr.responseStatus }}</span>
                                <span
                                    v-if='vr.eta'
                                    class='text-muted ms-auto'
                                >ETA {{ vr.eta }}</span>
                            </div>
                        </div>
                    </div>
                    <div
                        v-else
                        class='text-muted small'
                    >
                        No vehicles assigned
                    </div>

                    <!-- Responding personnel -->
                    <div class='small text-muted fw-semibold text-uppercase'>
                        Personnel ({{ detailIncident.personnelResponding?.length ?? 0 }})
                    </div>
                    <div
                        v-if='detailIncident.personnelResponding?.length'
                        class='card border'
                    >
                        <div class='card-body py-1 px-3'>
                            <div
                                v-for='pr in detailIncident.personnelResponding'
                                :key='pr.personUid'
                                class='d-flex align-items-center py-1 border-bottom border small gap-2'
                            >
                                <span class=''>{{ pr.callsign }}</span>
                            </div>
                        </div>
                    </div>
                    <div
                        v-else
                        class='text-muted small'
                    >
                        No personnel assigned
                    </div>

                    <!-- Notes -->
                    <div class='small text-muted fw-semibold text-uppercase'>
                        Notes
                    </div>
                    <div
                        v-if='detailIncident.notes?.length'
                        class='d-flex flex-column gap-1'
                    >
                        <div
                            v-for='note in detailIncident.notes'
                            :key='note.uid'
                            class='card border'
                        >
                            <div class='card-body py-1 px-3 small'>
                                <div class='d-flex align-items-center gap-2 text-muted mb-1'>
                                    <span class='fw-semibold'>{{ note.creator }}</span>
                                    <span>{{ formatTime(note.timestamp) }}</span>
                                    <button
                                        class='btn btn-sm btn-link text-danger py-0 px-1 ms-auto text-decoration-none'
                                        @click='deleteNote(note.uid)'
                                    >
                                        ✕
                                    </button>
                                </div>
                                <div style='white-space:pre-wrap'>
                                    {{ note.info }}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class='input-group'>
                        <input
                            v-model='newNote'
                            type='text'
                            class='form-control form-control-sm border'
                            placeholder='Add a note…'
                            @keyup.enter='addNote'
                        >
                        <button
                            class='btn btn-sm btn-secondary'
                            :disabled='!newNote.trim()'
                            @click='addNote'
                        >
                            Add
                        </button>
                    </div>

                    <!-- Actions -->
                    <div
                        v-if='detailError'
                        class='alert alert-danger py-2 small'
                    >
                        {{ detailError }}
                    </div>
                    <div class='d-flex gap-2 flex-wrap'>
                        <button
                            class='btn btn-sm btn-outline-warning'
                            @click='openEdit'
                        >
                            Edit
                        </button>
                        <button
                            v-if='isActive(detailIncident.status)'
                            class='btn btn-sm btn-outline-secondary'
                            :disabled='saving'
                            @click='closeIncident'
                        >
                            <span
                                v-if='saving'
                                class='spinner-border spinner-border-sm me-1'
                            />Close Incident
                        </button>
                        <button
                            class='btn btn-sm btn-outline-danger ms-auto'
                            :disabled='saving'
                            @click='confirmDelete'
                        >
                            Delete
                        </button>
                    </div>
                </div>
            </template>

            <!-- ── Responder Manager ───────────────────────────────── -->
            <template v-else-if='view === "responders" && detailIncident'>
                <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
                    <button
                        class='btn btn-sm btn-outline-secondary'
                        @click='view = "detail"'
                    >
                        ← Back
                    </button>
                    <span class='fw-semibold'>Assign Responders</span>
                </div>
                <div class='flex-grow-1 overflow-auto p-3 d-flex flex-column gap-3'>
                    <!-- Vehicles -->
                    <div class='small text-muted fw-semibold text-uppercase'>
                        Vehicles
                    </div>
                    <div
                        v-for='veh in vehicles'
                        :key='veh.uid'
                        class='d-flex align-items-center gap-2 py-1 border-bottom border small'
                    >
                        <input
                            type='checkbox'
                            :checked='isVehicleAssigned(veh.uid)'
                            class='form-check-input mt-0'
                            @change='toggleVehicle(veh.uid)'
                        >
                        <span class=''>{{ veh.callsign }}</span>
                        <span
                            v-if='veh.vehicleType'
                            class='text-muted'
                        >{{ veh.vehicleType.name }}</span>
                        <span
                            v-if='veh.incidentsRequestingThisVehicle?.length'
                            class='ms-auto badge bg-warning text-dark small'
                        >{{ veh.incidentsRequestingThisVehicle.length }} inc</span>
                    </div>
                    <div
                        v-if='!vehicles.length'
                        class='text-muted small'
                    >
                        No vehicles registered
                    </div>

                    <!-- Personnel -->
                    <div class='small text-muted fw-semibold text-uppercase'>
                        Personnel
                    </div>
                    <div
                        v-for='person in personnel'
                        :key='person.uid'
                        class='d-flex align-items-center gap-2 py-1 border-bottom border small'
                    >
                        <input
                            type='checkbox'
                            :checked='isPersonnelAssigned(person.uid)'
                            class='form-check-input mt-0'
                            @change='togglePersonnel(person.uid, person.callsign)'
                        >
                        <span class=''>{{ person.callsign }}</span>
                        <span
                            v-if='person.roles?.length'
                            class='text-muted'
                        >{{ person.roles.map(r => r.name).join(', ') }}</span>
                    </div>
                    <div
                        v-if='!personnel.length'
                        class='text-muted small'
                    >
                        No personnel registered
                    </div>

                    <div
                        v-if='detailError'
                        class='alert alert-danger py-2 small'
                    >
                        {{ detailError }}
                    </div>
                    <button
                        class='btn btn-sm btn-warning'
                        :disabled='saving'
                        @click='saveResponders'
                    >
                        <span
                            v-if='saving'
                            class='spinner-border spinner-border-sm me-1'
                        />Save Assignments
                    </button>
                </div>
            </template>

            <!-- ── Incident Form (takcad) ─────────────────────────── -->
            <template v-else-if='view === "form"'>
                <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
                    <button
                        class='btn btn-sm btn-outline-secondary'
                        @click='cancelForm'
                    >
                        ← Back
                    </button>
                    <span class='fw-semibold'>{{ editUid ? 'Edit Incident' : 'New Incident' }}</span>
                </div>
                <div class='flex-grow-1 overflow-auto p-3'>
                    <IncidentForm
                        :uid='editUid'
                        :server-mode='serverMode'
                        :incident-types='incidentTypes'
                        :active-feed='takcadFeed'
                        @saved='onFormSaved'
                        @cancel='cancelForm'
                    />
                </div>
            </template>
        </template>

        <!-- ── Standalone mode: server-backed Event board ──────────────────── -->
        <template v-else-if='serverMode === "standalone"'>
            <!-- Event gate (CadMain normally keeps the Events screen up until one is open) -->
            <div
                v-if='!dispatcherStore.activeEvent'
                class='text-center text-muted py-4 small px-3'
            >
                Open an Event to begin dispatching.
            </div>

            <!-- Standalone incident list -->
            <template v-else-if='slView === "list"'>
                <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
                    <div class='d-flex rounded overflow-hidden border flex-grow-1'>
                        <button
                            v-for='t in SL_TABS'
                            :key='t.key'
                            class='flex-fill btn btn-sm py-1 rounded-0 border-0 small'
                            :class='slTab === t.key ? "bg-primary text-white" : "text-muted"'
                            @click='slTab = t.key'
                        >
                            {{ t.label }} <span
                                class='badge'
                                :class='slTab === t.key ? "bg-warning text-dark" : "text-muted"'
                            >{{ t.key === 'active' ? slActiveIncidents.length : slClosedIncidents.length }}</span>
                        </button>
                    </div>
                    <button
                        class='btn btn-sm btn-warning'
                        @click='slView = "form"'
                    >
                        + New
                    </button>
                </div>
                <div class='flex-grow-1 overflow-auto'>
                    <div
                        v-if='!slDisplayedIncidents.length'
                        class='text-center text-muted py-4 small'
                    >
                        No {{ slTab }} incidents
                    </div>
                    <div
                        v-for='inc in slDisplayedIncidents'
                        :key='inc.id'
                        class='d-flex align-items-start px-3 py-2 border-bottom incident-row'
                        role='button'
                        @click='slOpenDetail(inc.id)'
                    >
                        <div class='flex-grow-1 overflow-hidden'>
                            <div class='d-flex align-items-center gap-2'>
                                <span class='fw-semibold small text-truncate'>{{ inc.number }} {{ inc.type }}</span>
                                <span
                                    class='badge small'
                                    :class='inc.status === "active" ? "bg-success text-white" : "bg-secondary text-white"'
                                >{{ inc.status }}</span>
                                <span
                                    v-if='inc.status === "active"'
                                    class='badge small'
                                    :class='slBoardClass(inc)'
                                >{{ BOARD_LABEL[boardState(inc.assigned)] }}</span>
                            </div>
                            <div class='small text-muted text-truncate'>
                                {{ inc.address || `${(inc.lat ?? 0).toFixed(5)}, ${(inc.lon ?? 0).toFixed(5)}` }}
                            </div>
                            <div class='small text-muted'>
                                {{ inc.type }} · {{ shortTime(inc.created_at) }}<template v-if='inc.report_number'>
                                    · Rpt {{ inc.report_number }}</template>
                            </div>
                            <div
                                v-if='inc.caller_name || inc.caller_phone'
                                class='small text-muted text-truncate'
                            >
                                Caller: {{ [inc.caller_name, inc.caller_phone].filter(Boolean).join(' · ') }}<template v-if='(inc.callers ?? []).length > 1'>
                                    (+{{ inc.callers.length - 1 }} more)</template>
                            </div>
                            <div
                                v-if='slLatestNoteText(inc)'
                                class='small fst-italic text-truncate'
                            >
                                {{ slLatestNoteText(inc) }}
                            </div>
                        </div>
                    </div>
                </div>
            </template>

            <!-- Standalone incident detail -->
            <template v-else-if='slView === "detail" && slDetail'>
                <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
                    <button
                        class='btn btn-sm btn-outline-secondary'
                        @click='slView = "list"'
                    >
                        ← Back
                    </button>
                    <span class='fw-semibold text-truncate flex-grow-1'>{{ slDetail.number }} {{ slDetail.type }}</span>
                    <span
                        class='badge'
                        :class='slDetail.status === "active" ? "bg-success text-white" : "bg-secondary text-white"'
                    >{{ slDetail.status }}</span>
                    <span
                        v-if='slDetail.status === "active"'
                        class='badge'
                        :class='slBoardClass(slDetail)'
                    >{{ BOARD_LABEL[boardState(slDetail.assigned)] }}</span>
                </div>
                <div class='flex-grow-1 overflow-auto p-3 d-flex flex-column gap-3'>
                    <div class='card border'>
                        <div class='card-body py-2 px-3 small d-flex flex-column gap-1'>
                            <div class='row g-1'>
                                <div class='col-4 text-muted'>
                                    Type
                                </div>
                                <div class='col-8'>
                                    {{ slDetail.type }}
                                </div>
                                <div class='col-4 text-muted'>
                                    Time
                                </div>
                                <div class='col-8'>
                                    {{ formatTime(slDetail.created_at) }}
                                </div>
                                <div class='col-4 text-muted'>
                                    Address
                                </div>
                                <div class='col-8'>
                                    {{ slDetail.address || '—' }}
                                </div>
                                <div class='col-4 text-muted'>
                                    Coords
                                </div>
                                <div
                                    class='col-8 font-monospace text-muted'
                                    style='font-size:11px'
                                >
                                    {{ (slDetail.lat ?? 0).toFixed(6) }}, {{ (slDetail.lon ?? 0).toFixed(6) }}
                                </div>
                                <div class='col-4 text-muted'>
                                    Dispatcher
                                </div>
                                <div class='col-8'>
                                    {{ slDetail.dispatcher || '—' }}
                                </div>
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
                                            @keydown.enter='slSaveReportNumber(slDetail)'
                                            @keydown.esc='slReportEditing = false'
                                        >
                                        <button
                                            class='btn btn-sm btn-outline-secondary'
                                            :disabled='slSaving'
                                            @click='slSaveReportNumber(slDetail)'
                                        >
                                            Save
                                        </button>
                                    </div>
                                    <template v-else>
                                        {{ slDetail.report_number || '—' }}
                                        <button
                                            class='btn btn-link btn-sm p-0 ms-1 text-decoration-none'
                                            @click='slStartReportEdit(slDetail)'
                                        >
                                            {{ slDetail.report_number ? 'Edit' : 'Add' }}
                                        </button>
                                    </template>
                                </div>
                                <template v-if='slDetail.details'>
                                    <div class='col-4 text-muted'>
                                        Details
                                    </div>
                                    <div
                                        class='col-8'
                                        style='white-space:pre-wrap'
                                    >
                                        {{ slDetail.details }}
                                    </div>
                                </template>
                            </div>
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
                            v-for='c in (slDetail.callers ?? [])'
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
                                    @click='slMakePrimary(slDetail, c)'
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
                                    @click='slRemoveCaller(slDetail, c)'
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                        <div
                            v-if='!(slDetail.callers ?? []).length && slCallerForm === null'
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
                                    @keydown.enter='slSaveCallerForm(slDetail)'
                                    @keydown.esc='slCallerForm = null'
                                >
                            </label>
                            <div class='d-flex gap-1'>
                                <button
                                    class='btn btn-sm btn-outline-secondary'
                                    :disabled='slSaving'
                                    data-test='save-caller'
                                    @click='slSaveCallerForm(slDetail)'
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
                        v-if='slDetail.notes.length'
                        class='border-top pt-2 mt-2'
                    >
                        <div class='small text-muted mb-1'>Notes</div>
                        <div
                            v-for='(n, i) in slDetail.notes'
                            :key='i'
                            class='small mb-1'
                        >
                            <span class='text-muted'>{{ shortTime(n.time) }}</span>
                            {{ n.text }}
                        </div>
                    </div>

                    <!-- Add note (active only) -->
                    <div
                        v-if='slDetail.status === "active"'
                        class='d-flex gap-1 mt-2'
                    >
                        <input
                            v-model='slNoteInput'
                            type='text'
                            class='form-control form-control-sm border flex-grow-1'
                            placeholder='Add note…'
                            @keydown.enter='slAddNote(slDetail)'
                        >
                        <button
                            class='btn btn-sm btn-outline-secondary'
                            :disabled='!slNoteInput.trim()'
                            @click='slAddNote(slDetail)'
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
                            v-for='c in slDetail.assigned'
                            :key='c.uid'
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
                                    v-if='slDetail.status === "active" && unitStatus(c) === "assigned"'
                                    class='btn btn-sm btn-outline-warning py-0'
                                    :disabled='slSaving'
                                    @click='slSetUnitStatus(slDetail, c, "on_scene")'
                                >
                                    On Scene
                                </button>
                                <button
                                    v-if='slDetail.status === "active" && unitStatus(c) !== "cleared"'
                                    class='btn btn-sm btn-outline-secondary py-0'
                                    :disabled='slSaving'
                                    @click='slSetUnitStatus(slDetail, c, "cleared")'
                                >
                                    Clear
                                </button>
                                <button
                                    v-if='slDetail.status === "active"'
                                    class='btn btn-link btn-sm p-0 text-danger text-decoration-none'
                                    title='Assigned by mistake: remove from the record'
                                    @click='slUnassignContact(slDetail, c.uid)'
                                >
                                    ✕
                                </button>
                            </div>
                            <div class='text-muted'>
                                {{ unitTimesLine(c, shortTime) }}
                            </div>
                        </div>
                        <div
                            v-if='!slDetail.assigned.length'
                            class='text-muted small py-1'
                        >
                            No units assigned
                        </div>

                        <!-- Assign: free-text search + contacts picker button (active only) -->
                        <template v-if='slDetail.status === "active"'>
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
                                <button
                                    v-for='c in filteredContacts'
                                    :key='c.uid'
                                    class='btn btn-sm w-100 text-start px-2 py-1 border-0 border-bottom rounded-0'
                                    style='font-size:12px'
                                    @click='slAssignContact(slDetail, c)'
                                >
                                    + {{ c.callsign }}
                                </button>
                            </div>

                            <!-- Multi-select contacts picker (mirrors CloudTAK's contacts tool) -->
                            <div
                                v-if='showContactPicker'
                                class='border rounded mt-1'
                            >
                                <div class='small text-muted px-2 py-1 border-bottom d-flex align-items-center'>
                                    <span class='flex-grow-1'>Select units to assign</span>
                                    <span>{{ pickerSelected.length }} selected</span>
                                </div>
                                <div style='max-height:160px;overflow-y:auto'>
                                    <label
                                        v-for='c in assignablePickerContacts'
                                        :key='c.uid'
                                        class='d-flex align-items-center gap-2 px-2 py-1 border-bottom small mb-0'
                                        style='cursor:pointer'
                                    >
                                        <input
                                            type='checkbox'
                                            class='form-check-input mt-0'
                                            :checked='pickerSelected.includes(c.uid)'
                                            @change='togglePickerContact(c.uid)'
                                        >
                                        <span class='flex-grow-1'>{{ c.callsign }}</span>
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
                                        :disabled='!pickerSelected.length'
                                        @click='slAssignSelected(slDetail)'
                                    >
                                        Assign {{ pickerSelected.length || '' }} selected
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
                    <div class='d-flex gap-2 mt-2'>
                        <button
                            class='btn btn-sm btn-outline-secondary'
                            @click='flyToIncident(slDetail)'
                        >
                            Show on Map
                        </button>
                        <button
                            v-if='slDetail.status === "active"'
                            class='btn btn-sm btn-warning ms-auto'
                            :disabled='slSaving'
                            @click='slCloseIncident(slDetail)'
                        >
                            Close Incident
                        </button>
                        <button
                            v-else
                            class='btn btn-sm btn-outline-warning ms-auto'
                            :disabled='slSaving'
                            @click='slReopenIncident(slDetail)'
                        >
                            Reopen
                        </button>
                    </div>
                </div>
            </template>

            <!-- Standalone incident form -->
            <template v-else-if='slView === "form"'>
                <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
                    <button
                        class='btn btn-sm btn-outline-secondary'
                        @click='slView = "list"'
                    >
                        ← Back
                    </button>
                    <span class='fw-semibold'>New Incident</span>
                </div>
                <div class='flex-grow-1 overflow-auto p-3'>
                    <IncidentForm
                        :server-mode='serverMode'
                        :incident-types='incidentTypes'
                        @saved-standalone='onStandaloneSaved'
                        @cancel='slView = "list"'
                    />
                </div>
            </template>
        </template>

        <!-- ── Detecting state ─────────────────────────────────────────────── -->
        <template v-else>
            <div class='text-center text-muted py-4 small'>
                <span class='spinner-border spinner-border-sm me-2' />Connecting…
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { IconUsers } from '@tabler/icons-vue';
import { useMapStore } from '../../../src/stores/map.ts';
import IncidentForm from './IncidentForm.vue';
import {
    getIncidentMetadata, getIncident,
    updateIncident, deleteIncident,
    insertVehicleResponse, deleteVehicleResponse,
    postMissionLog,
} from '../lib/takcad-client.ts';
import type { VehicleResponseMetadata } from '../lib/takcad-client.ts';
import { dialablePhone as slDialable } from '../lib/map-marker.ts';
import { showIncident, closeIncidentInField } from '../lib/field-delivery.ts';
import { getContacts, sendAssignmentMessage, sendUpdateMessage } from '../lib/contacts-client.ts';
import type { TakContact } from '../lib/contacts-client.ts';
import type { IncidentMetadata, IncidentRef, VehicleRef, PersonRef, IncidentTypeRef, PersonCallsign } from '../lib/takcad-types.ts';
import { isActive, formatAddress, formatTime, STATUS_CANCELLED } from '../lib/takcad-types.ts';
import type { MissionRef } from '../lib/takcad-client.ts';
import { listIncidents, patchIncident, getCallerOnMarkers, addCaller, updateCaller, removeCaller, assignUnits, setUnitStatus, removeUnit } from '../lib/events-client.ts';
import type { DispatcherIncident, AssignedContact, IncidentCaller } from '../lib/events-client.ts';
import { dispatcherStore } from '../lib/dispatcher-store.ts';
import { BOARD_LABEL, boardState, respondingLine, unitStatus, unitTimesLine } from '../lib/unit-status.ts';

const props = defineProps<{
    serverMode:    'detecting' | 'takcad' | 'standalone';
    incidentTypes: IncidentTypeRef[];
    vehicles:      VehicleRef[];
    personnel:     PersonRef[];
    takcadFeed?:   MissionRef | null;
}>();

const emit = defineEmits<{
    (e: 'active-count', n: number): void;
    (e: 'status',       s: string): void;
}>();

const mapStore = useMapStore();

// ── TAK-CAD mode state ────────────────────────────────────────────────────────
type ViewName = 'list' | 'detail' | 'form' | 'responders';
type ListTab  = 'active' | 'cancelled';

const SORT_COLS = [
    { key: 'time',    label: 'Time'    },
    { key: 'address', label: 'Address' },
    { key: 'type',    label: 'Type'    },
] as const;
type SortCol = typeof SORT_COLS[number]['key'];

const LIST_TABS = [
    { key: 'active',    label: 'Active'    },
    { key: 'cancelled', label: 'Cancelled' },
] as const;

const view           = ref<ViewName>('list');
const listTab        = ref<ListTab>('active');
const incidents      = ref<IncidentMetadata[]>([]);
const detailIncident = ref<IncidentRef | null>(null);
const loading        = ref(false);
const loadError      = ref('');
const detailError    = ref('');
const saving         = ref(false);
const editUid        = ref<string | undefined>(undefined);
const newNote        = ref('');
const lastRefreshed  = ref('');
const sortCol        = ref<SortCol>('time');
const sortAsc        = ref(false);

const pendingVehicleUids    = ref<string[]>([]);
const vehicleResponseUids   = ref<Map<string, string>>(new Map());
const pendingPersonnelItems = ref<PersonCallsign[]>([]);

const activeIncidents    = computed(() => incidents.value.filter(i => isActive(i.status)));
const cancelledIncidents = computed(() => incidents.value.filter(i => !isActive(i.status)));

const displayedIncidents = computed(() => {
    const src = listTab.value === 'active' ? activeIncidents.value : cancelledIncidents.value;
    return [...src].sort((a, b) => {
        let av = '', bv = '';
        if (sortCol.value === 'time')    { av = a.incidentTime; bv = b.incidentTime; }
        if (sortCol.value === 'address') { av = formatAddress(a.location); bv = formatAddress(b.location); }
        if (sortCol.value === 'type')    { av = a.incidentType ?? ''; bv = b.incidentType ?? ''; }
        return sortAsc.value ? av.localeCompare(bv) : bv.localeCompare(av);
    });
});

watch(activeIncidents, n => {
    if (props.serverMode === 'takcad') emit('active-count', n.length);
}, { immediate: true });

function toggleSort(col: SortCol) {
    if (sortCol.value === col) sortAsc.value = !sortAsc.value;
    else { sortCol.value = col; sortAsc.value = col !== 'time'; }
}

function statusBadge(status: string) {
    if (status === 'ACTIVE')    return 'bg-success text-white';
    if (status === 'CANCELLED') return 'bg-secondary text-white';
    return 'bg-warning text-dark';
}

function shortTime(iso: string): string {
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
}

async function loadList() {
    loading.value = true; loadError.value = '';
    try {
        incidents.value = await getIncidentMetadata();
        lastRefreshed.value = new Date().toLocaleTimeString();
        emit('status', '');
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        loadError.value = msg;
        emit('status', 'Error');
    } finally {
        loading.value = false;
    }
}

async function openDetail(uid: string) {
    detailError.value = '';
    view.value = 'detail';
    try { detailIncident.value = await getIncident(uid); }
    catch (e) { detailError.value = e instanceof Error ? e.message : String(e); }
}

function openCreate() { editUid.value = undefined; view.value = 'form'; }
function openEdit()   { if (!detailIncident.value) return; editUid.value = detailIncident.value.uid; view.value = 'form'; }
function cancelForm() { view.value = detailIncident.value ? 'detail' : 'list'; }

async function onFormSaved(uid: string) {
    await openDetail(uid);
    await loadList();
}

async function closeIncident() {
    if (!detailIncident.value) return;
    saving.value = true; detailError.value = '';
    try {
        const updated = { ...detailIncident.value, status: STATUS_CANCELLED };
        await updateIncident(updated);
        const check = await getIncident(detailIncident.value.uid);
        if (isActive(check.status)) {
            detailError.value = 'The TAK-CAD server accepted the update but didn\'t change the status — cancelling incidents isn\'t supported by this server build.';
        } else {
            detailIncident.value = check;
            await loadList();
        }
    } catch (e) {
        detailError.value = e instanceof Error ? e.message : String(e);
    } finally {
        saving.value = false;
    }
}

async function confirmDelete() {
    if (!detailIncident.value) return;
    if (!confirm(`Delete incident "${detailIncident.value.incidentName}"?`)) return;
    saving.value = true; detailError.value = '';
    try {
        await deleteIncident(detailIncident.value.uid);
        view.value = 'list';
        detailIncident.value = null;
        await loadList();
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        detailError.value = msg.includes('PluginManager process')
            ? 'Delete isn\'t supported by the TAK Server plugin on this build. Use "Close Incident" to cancel it instead.'
            : msg;
    } finally {
        saving.value = false;
    }
}

async function addNote() {
    if (!detailIncident.value || !newNote.value.trim()) return;
    const note = {
        uid:         crypto.randomUUID(),
        info:        newNote.value.trim(),
        creator:     'Dispatcher',
        incidentUid: detailIncident.value.uid,
        timestamp:   new Date().toISOString(),
    };
    const updated = { ...detailIncident.value, notes: [...(detailIncident.value.notes ?? []), note] };
    saving.value = true; detailError.value = '';
    try {
        await updateIncident(updated);
        detailIncident.value = updated;
        newNote.value = '';
    } catch (e) {
        detailError.value = e instanceof Error ? e.message : String(e);
    } finally {
        saving.value = false;
    }
}

async function deleteNote(noteUid: string) {
    if (!detailIncident.value) return;
    const updated = { ...detailIncident.value, notes: detailIncident.value.notes.filter(n => n.uid !== noteUid) };
    saving.value = true; detailError.value = '';
    try {
        await updateIncident(updated);
        detailIncident.value = updated;
    } catch (e) {
        detailError.value = e instanceof Error ? e.message : String(e);
    } finally {
        saving.value = false;
    }
}

watch(view, (v) => {
    if (v === 'responders' && detailIncident.value) {
        const resMap = new Map<string, string>();
        (detailIncident.value.vehiclesResponding ?? []).forEach(vr => {
            resMap.set(vr.vehicle.vehicleUid, vr.uid);
        });
        vehicleResponseUids.value   = resMap;
        pendingVehicleUids.value    = [...resMap.keys()];
        pendingPersonnelItems.value = [...(detailIncident.value.personnelResponding ?? [])];
    }
});

function isVehicleAssigned(uid: string)   { return pendingVehicleUids.value.includes(uid); }
function isPersonnelAssigned(uid: string) { return pendingPersonnelItems.value.some(p => p.personUid === uid); }

function toggleVehicle(uid: string) {
    if (isVehicleAssigned(uid)) pendingVehicleUids.value = pendingVehicleUids.value.filter(u => u !== uid);
    else pendingVehicleUids.value = [...pendingVehicleUids.value, uid];
}

function togglePersonnel(uid: string, callsign: string) {
    if (isPersonnelAssigned(uid)) pendingPersonnelItems.value = pendingPersonnelItems.value.filter(p => p.personUid !== uid);
    else pendingPersonnelItems.value = [...pendingPersonnelItems.value, { personUid: uid, callsign }];
}

async function saveResponders() {
    if (!detailIncident.value) return;
    saving.value = true; detailError.value = '';
    const incidentUid = detailIncident.value.uid;
    const prevUids    = [...vehicleResponseUids.value.keys()];
    const toAdd       = pendingVehicleUids.value.filter(uid => !prevUids.includes(uid));
    const toRemove    = prevUids.filter(uid => !pendingVehicleUids.value.includes(uid));
    try {
        for (const vehUid of toRemove) {
            const respUid = vehicleResponseUids.value.get(vehUid);
            if (respUid) await deleteVehicleResponse(respUid);
        }
        for (const vehUid of toAdd) {
            const veh = props.vehicles.find(v => v.uid === vehUid);
            const meta: VehicleResponseMetadata = {
                uid:            crypto.randomUUID(),
                callsign:       veh?.callsign ?? '',
                vehicleUid:     vehUid,
                incidentUid,
                responseStatus: 'IN_ROUTE',
                eta:            null,
                arrivalTime:    null,
            };
            await insertVehicleResponse(meta);
        }
        detailIncident.value = await getIncident(incidentUid);
        view.value = 'detail';
    } catch (e) {
        detailError.value = e instanceof Error ? e.message : String(e);
    } finally {
        saving.value = false;
    }
}

async function refreshDetail() {
    if (detailIncident.value && view.value === 'detail') {
        try { detailIncident.value = await getIncident(detailIncident.value.uid); }
        catch { /* stale display ok */ }
    }
}

// ── Standalone mode state (server-backed Event board) ─────────────────────────
type SlViewName = 'list' | 'detail' | 'form';
type SlTab      = 'active' | 'closed';

const SL_TABS = [
    { key: 'active', label: 'Active' },
    { key: 'closed', label: 'Closed' },
] as const;

const slView            = ref<SlViewName>('list');
const slTab             = ref<SlTab>('active');
const slDetail          = ref<DispatcherIncident | null>(null);
const slNoteInput       = ref('');
const slReportEditing   = ref(false);
const slReportInput     = ref('');
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

const filteredContacts = computed(() => {
    const q = slContactSearch.value.toLowerCase();
    const assigned = new Set((slDetail.value?.assigned ?? []).map(c => c.uid));
    return allContacts.value.filter(c =>
        !assigned.has(c.uid) &&
        (!q || c.callsign.toLowerCase().includes(q))
    );
});

// Contacts not yet assigned — the multi-select picker's candidate list.
const assignablePickerContacts = computed(() => {
    const assigned = new Set((slDetail.value?.assigned ?? []).map(c => c.uid));
    return allContacts.value.filter(c => !assigned.has(c.uid));
});

// Refetch the live contacts list (keeps the previous list on failure). Called whenever
// the dispatcher opens an incident or the picker, so users who connected after the panel
// loaded show up without a reload.
async function loadContacts() {
    loadingContacts.value = true;
    try { allContacts.value = await getContacts(); }
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
    const chosen = allContacts.value.filter(c => pickerSelected.value.includes(c.uid));
    pickerSelected.value = [];
    showContactPicker.value = false;
    if (!chosen.length) return;

    // Use the freshest incident state (the passed `inc` can be a stale snapshot), and assign
    // ALL selected in ONE call.
    const cur = dispatcherStore.incidents.find(i => i.id === inc.id) ?? inc;
    const existing = cur.assigned ?? [];
    const toAdd = chosen.filter(c => !existing.some(a => a.uid === c.uid));
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
        const feed = dispatcherStore.activeEvent;
        if (feed) {
            for (const c of toAdd) {
                try { await postMissionLog(feed.feed_name, `ASSIGNED: ${updated.number} → ${c.callsign}`); }
                catch { /* best-effort */ }
            }
        }
    } catch (e) {
        slDetailError.value = e instanceof Error ? e.message : String(e);
    }
}

const slActiveIncidents = computed(() =>
    dispatcherStore.incidents.filter(i => i.status === 'active')
);
const slClosedIncidents = computed(() =>
    dispatcherStore.incidents.filter(i => i.status === 'closed')
);
const slDisplayedIncidents = computed(() =>
    slTab.value === 'active' ? slActiveIncidents.value : slClosedIncidents.value
);

// Card snippet: newest note (notes append chronologically), falling back to details
// for incidents created before details started seeding the notes log.
function slLatestNoteText(inc: DispatcherIncident): string {
    const n = inc.notes?.[inc.notes.length - 1];
    return n?.text ?? inc.details ?? '';
}

watch(slActiveIncidents, n => {
    if (props.serverMode === 'standalone') emit('active-count', n.length);
}, { immediate: true });

// Build the marker payload for an incident, folding responders + notes into the remarks
// details (same presentation as before, now sourced from server fields).
function slMarkerFor(inc: DispatcherIncident, extraDetail = '') {
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
        feedGuid:   dispatcherStore.activeEvent?.feed_guid,
        delivery:    dispatcherStore.activeEvent?.delivery,
        channel:     dispatcherStore.activeEvent?.channel,
        coreEventId: inc.core_event_id,
        closedAt:    inc.closed_at,
    };
}

// Merge a server-returned incident back into the store + open detail.
function slApplyIncident(updated: DispatcherIncident) {
    const idx = dispatcherStore.incidents.findIndex(i => i.id === updated.id);
    if (idx !== -1) dispatcherStore.incidents[idx] = updated;
    else dispatcherStore.incidents.push(updated);
    if (slDetail.value?.id === updated.id) slDetail.value = updated;
}

async function slLoadIncidents() {
    const ev = dispatcherStore.activeEvent;
    if (!ev) return;
    try {
        const list = await listIncidents(ev.id);
        dispatcherStore.incidents = list;
        if (slDetail.value) {
            const fresh = list.find(i => i.id === slDetail.value!.id);
            if (fresh) slDetail.value = fresh;
        }
    } catch { /* keep previous list */ }
}

async function slOpenDetail(id: string) {
    slDetail.value = dispatcherStore.incidents.find(i => i.id === id) ?? null;
    slView.value = 'detail';
    slContactSearch.value = '';
    slDetailError.value = '';
    slReportEditing.value = false;
    slCallerForm.value = null;
    slRefreshCallerSetting();
    showContactPicker.value = false;
    pickerSelected.value = [];
    await loadContacts();
}

async function slAssignContact(inc: DispatcherIncident, contact: TakContact) {
    if ((inc.assigned ?? []).some(c => c.uid === contact.uid)) return;
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
        const feed = dispatcherStore.activeEvent;
        if (feed) {
            try { await postMissionLog(feed.feed_name, `ASSIGNED: ${updated.number} → ${contact.callsign}`); }
            catch { /* best-effort */ }
        }
    } catch (e) {
        slDetailError.value = e instanceof Error ? e.message : String(e);
    }
}

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

async function slRemoveCaller(inc: DispatcherIncident, c: IncidentCaller) {
    const label = [c.name, c.phone].filter(Boolean).join(' · ');
    if (!confirm(`Remove caller ${label}? This deletes them from the incident record.`)) return;
    if (slCallerForm.value === c.id) slCallerForm.value = null;
    await slCallerChange(() => removeCaller(inc.id, c.id));
}

async function slUnassignContact(inc: DispatcherIncident, uid: string) {
    const contact = (inc.assigned ?? []).find(c => c.uid === uid);
    slDetailError.value = '';

    try {
        const updated = await removeUnit(inc.id, uid);
        slApplyIncident(updated);

        const feed = dispatcherStore.activeEvent;
        if (feed && contact) {
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

        const feed = dispatcherStore.activeEvent;
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

function slBoardClass(inc: DispatcherIncident): string {
    const b = boardState(inc.assigned);
    return b === 'on_scene' ? 'bg-warning text-dark' : b === 'dispatched' ? 'bg-info text-dark' : 'bg-light text-dark border';
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
        const feed = dispatcherStore.activeEvent;
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

async function slCloseIncident(inc: DispatcherIncident) {
    slSaving.value = true; slDetailError.value = '';
    try {
        const stillOn = (inc.assigned ?? []).filter(u => unitStatus(u) !== 'cleared');
        const updated = await patchIncident(inc.id, { status: 'closed' });
        slApplyIncident(updated);

        // DataSync: remove the marker (record stays server-side). Broadcast: mark it CLOSED;
        // it drops off field devices 60 minutes after closing.
        try { await closeIncidentInField(mapStore, slMarkerFor(updated)); }
        catch { /* best-effort */ }

        // DataSync log entry
        const feed = dispatcherStore.activeEvent;
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
                await postMissionLog(feed.feed_name, `INCIDENT CLOSED: ${updated.number} | ${updated.type ?? ''} | Closed ${hhmm} | ${durMin} min`);
            } catch { /* best-effort */ }
        }
        slView.value = 'list';
        slTab.value = 'closed';
    } catch (e) {
        slDetailError.value = e instanceof Error ? e.message : String(e);
    } finally {
        slSaving.value = false;
    }
}

async function slReopenIncident(inc: DispatcherIncident) {
    slSaving.value = true; slDetailError.value = '';
    try {
        const updated = await patchIncident(inc.id, { status: 'active' });
        slApplyIncident(updated);

        // Re-drop the CoT marker to the feed (broadcast: reopen the Core Event)
        try { await showIncident(mapStore, slMarkerFor(updated)); }
        catch { /* best-effort */ }

        const feed = dispatcherStore.activeEvent;
        if (feed) {
            try { await postMissionLog(feed.feed_name, `INCIDENT REOPENED: ${updated.number} | ${updated.type ?? ''}`); }
            catch { /* best-effort */ }
        }
        slTab.value = 'active';
    } catch (e) {
        slDetailError.value = e instanceof Error ? e.message : String(e);
    } finally {
        slSaving.value = false;
    }
}

function flyToIncident(inc: DispatcherIncident) {
    mapStore.map?.flyTo({ center: [inc.lon ?? 0, inc.lat ?? 0], zoom: 15 });
}

function onStandaloneSaved(inc: DispatcherIncident) {
    const idx = dispatcherStore.incidents.findIndex(i => i.id === inc.id);
    if (idx === -1) dispatcherStore.incidents.push(inc);
    slView.value = 'list';
    slTab.value = 'active';
}

// ── Polling ───────────────────────────────────────────────────────────────────
let pollTimer: ReturnType<typeof setInterval>;

function startTakcadPoll() {
    loadList();
    pollTimer = setInterval(() => { loadList(); refreshDetail(); }, 15_000);
}

// The Manage-panel toggle is shared across dispatchers, so re-read it when the board starts
// and when an incident is opened (cheap) rather than on every poll (the settings blob can
// carry the agency logo).
function slRefreshCallerSetting() {
    getCallerOnMarkers().then((on) => { dispatcherStore.callerOnMarkers = on; }).catch(() => { /* keep last */ });
}

// Standalone: 15s poll of the open Event's incidents so multiple dispatchers converge.
function startStandalonePoll() {
    slLoadIncidents();
    slRefreshCallerSetting();
    pollTimer = setInterval(() => { slLoadIncidents(); }, 15_000);
}

onMounted(() => {
    if (props.serverMode === 'takcad') startTakcadPoll();
    else if (props.serverMode === 'standalone' && dispatcherStore.activeEvent) startStandalonePoll();
});

onUnmounted(() => clearInterval(pollTimer));

// Start polling when mode resolves
watch(() => props.serverMode, (mode) => {
    if (pollTimer) return;
    if (mode === 'takcad') startTakcadPoll();
    else if (mode === 'standalone' && dispatcherStore.activeEvent) startStandalonePoll();
});

// Restart the standalone poll when an Event is opened/changed.
watch(() => dispatcherStore.activeEvent?.id, (id) => {
    if (props.serverMode !== 'standalone') return;
    clearInterval(pollTimer);
    pollTimer = undefined as unknown as ReturnType<typeof setInterval>;
    slView.value = 'list';
    slDetail.value = null;
    if (id) startStandalonePoll();
});
</script>

<style scoped>
.incident-row:hover { background: rgba(255,255,255,.05); cursor: pointer; }
</style>
