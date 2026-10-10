// hooks/useDeliveryYardPlace.ts — where "Coming From" is on the map (lane
// DELIVERIES-2, part 3).
//
// The supplier types where the load is coming from on the link ("Sample Stone
// Yard, Red Hook, Brooklyn"). This turns those words into a place with the
// app's existing address lookup (utils/geocodeProject: OpenStreetMap's
// Nominatim, throttled and cached there). It is the only thing this hook does.
//
// The words go to that lookup service from the CONTRACTOR'S device, and only
// when a delivery's sheet with a "Coming From" is open. No device location is
// read: this is an address someone typed. With no answer (offline, or words
// the lookup cannot place) the map is simply not drawn.
import { useQuery } from '@tanstack/react-query';
import { geocodeProjectLocation } from '@/utils/geocodeProject';
import { isPlace, type LatLng } from '@/utils/deliveryLink/mapMath';

/** `place` is the yard on the map, or null. `looked` is true once the lookup has answered (so "could not find it" is not said while it is still asking). */
export function useDeliveryYardPlace(comingFrom: string, enabled: boolean): { place: LatLng | null; looked: boolean } {
  const words = comingFrom.trim();
  const query = useQuery({
    queryKey: ['delivery-yard-place', words.toLowerCase()],
    queryFn: async (): Promise<LatLng | null> => {
      const hit = await geocodeProjectLocation(words);
      return hit && isPlace(hit) ? { latitude: hit.latitude, longitude: hit.longitude } : null;
    },
    enabled: enabled && words.length >= 3,
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
  return { place: query.data ?? null, looked: query.isSuccess || query.isError };
}

export default useDeliveryYardPlace;
