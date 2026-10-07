// Friendly, deterministic handles derived from an observer id ("Heron-4F2A"), so people have a
// name without an account. Collisions are irrelevant: the id is the identity, the name is a label.

const A = ['Amber', 'Azure', 'Brisk', 'Civic', 'Dusky', 'Early', 'Faint', 'Gilded', 'Hollow', 'Ivory', 'Keen', 'Lunar', 'Mellow', 'Nimble', 'Opal', 'Polar', 'Quiet', 'Rapid', 'Solar', 'Tidal', 'Vivid', 'Wild', 'Zonal', 'Clear'];
const B = ['Heron', 'Falcon', 'Lynx', 'Otter', 'Plover', 'Kestrel', 'Marten', 'Ibis', 'Wren', 'Orca', 'Gecko', 'Tern', 'Bison', 'Finch', 'Puffin', 'Quokka', 'Raven', 'Saola', 'Tapir', 'Vole', 'Yak', 'Egret', 'Dunlin', 'Newt'];

export function observerName(id) {
  const n = parseInt(id.slice(0, 8), 16);
  return `${A[n % A.length]} ${B[(n >>> 5) % B.length]}`;
}

export const shortId = (id) => id.slice(0, 4).toUpperCase();
