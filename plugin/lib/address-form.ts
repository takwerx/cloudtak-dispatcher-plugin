// An incident keeps one address line, written by the form as "street, city, state". The two
// functions below are that line's two directions. Changing an incident's location reads the line
// back into the boxes: with a part missing they may not be the boxes it was typed in, but joining
// them again gives the same line.
export function joinAddress(street: string, city: string, state: string): string {
    return [street, city, state].map(p => p.trim()).filter(Boolean).join(', ');
}

export function splitAddress(address: string): { streetName: string; city: string; state: string } {
    const parts = address.split(',').map(p => p.trim()).filter(Boolean);
    const [city, state] = parts.length >= 3 ? parts.slice(-2) : [parts[1] ?? '', ''];
    const streetName = parts.length >= 3 ? parts.slice(0, -2).join(', ') : parts[0] ?? '';
    return { streetName, city, state };
}
