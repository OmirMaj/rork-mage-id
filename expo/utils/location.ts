import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STATE_CENTROIDS } from '@/constants/zipCodes';

const LOCATION_CACHE_KEY = 'mageid_user_location';
const LOCATION_RADIUS_KEY = 'mageid_search_radius';

export interface UserLocation {
  latitude: number;
  longitude: number;
  cityName?: string;
  stateName?: string;
}

export function getDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function getDistanceFromState(lat: number, lon: number, stateCode: string): number | null {
  const centroid = STATE_CENTROIDS[stateCode.toUpperCase()];
  if (!centroid) return null;
  return getDistanceMiles(lat, lon, centroid.lat, centroid.lon);
}

export function formatDistance(miles: number | null): string {
  if (miles === null) return 'Unknown';
  if (miles < 1) return '<1 mi';
  if (miles >= 1000) return `${Math.round(miles / 100) * 100} mi`;
  return `${miles} mi`;
}

async function reverseGeocode(lat: number, lon: number): Promise<{ city: string; state: string } | null> {
  if (Platform.OS !== 'web') {
    try {
      const Location = await import('expo-location');
      const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
      if (results && results.length > 0) {
        const r = results[0];
        return {
          city: r.city ?? r.subregion ?? 'Unknown',
          state: r.region ?? '',
        };
      }
    } catch (err) {
      console.log('[Location] Reverse geocode failed:', err);
    }
  }
  return guessLocationFromCoords(lat, lon);
}

function guessLocationFromCoords(lat: number, lon: number): { city: string; state: string } | null {
  let closestState = '';
  let minDist = Infinity;
  for (const [code, centroid] of Object.entries(STATE_CENTROIDS)) {
    const dist = getDistanceMiles(lat, lon, centroid.lat, centroid.lon);
    if (dist < minDist) {
      minDist = dist;
      closestState = code;
    }
  }
  if (closestState) {
    return { city: '', state: closestState };
  }
  return null;
}

export function useUserLocation() {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [radius, setRadius] = useState<number>(25);

  useEffect(() => {
    AsyncStorage.getItem(LOCATION_CACHE_KEY).then(data => {
      if (data) {
        try {
          const cached = JSON.parse(data) as UserLocation & { timestamp: number };
          const age = Date.now() - (cached.timestamp ?? 0);
          if (age < 24 * 60 * 60 * 1000) {
            setLocation(cached);
            console.log('[Location] Using cached location:', cached.cityName, cached.stateName);
          }
        } catch { /* ignore */ }
      }
    }).catch(() => {});

    AsyncStorage.getItem(LOCATION_RADIUS_KEY).then(data => {
      if (data) {
        const r = parseInt(data, 10);
        if (!isNaN(r) && r > 0) setRadius(r);
      }
    }).catch(() => {});
  }, []);

  const requestLocation = useCallback(async (highAccuracy = true) => {
    setLoading(true);
    setError(null);
    try {
      let coords: { latitude: number; longitude: number } | null = null;

      if (Platform.OS === 'web') {
        if ('geolocation' in navigator) {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 15000,
              maximumAge: 60000,
            });
          });
          coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          console.log('[Location] Web location obtained:', coords.latitude, coords.longitude);
        } else {
          setError('Geolocation not supported');
          console.log('[Location] Geolocation not supported on web');
        }
      } else {
        const Location = await import('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setError('Location permission denied. Please enable location in your device Settings.');
          console.log('[Location] Permission denied');
          setLoading(false);
          return;
        }

        const servicesEnabled = await Location.hasServicesEnabledAsync();
        if (!servicesEnabled) {
          setError('Location services are turned off. Please enable them in your device Settings.');
          console.log('[Location] Location services disabled');
          setLoading(false);
          return;
        }

        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: highAccuracy ? Location.Accuracy.High : Location.Accuracy.Balanced,
            timeInterval: 5000,
            distanceInterval: 0,
          });
          coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          console.log('[Location] Native location obtained (high accuracy):', coords.latitude, coords.longitude);
        } catch (highAccErr) {
          console.log('[Location] High accuracy failed, trying balanced:', highAccErr);
          try {
            const loc = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
            console.log('[Location] Native location obtained (balanced):', coords.latitude, coords.longitude);
          } catch (balancedErr) {
            console.log('[Location] Balanced failed, trying last known:', balancedErr);
            const lastKnown = await Location.getLastKnownPositionAsync();
            if (lastKnown) {
              coords = { latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude };
              console.log('[Location] Using last known position:', coords.latitude, coords.longitude);
            }
          }
        }
      }

      if (coords) {
        const geo = await reverseGeocode(coords.latitude, coords.longitude);
        const loc: UserLocation = {
          latitude: coords.latitude,
          longitude: coords.longitude,
          cityName: geo?.city ?? undefined,
          stateName: geo?.state ?? undefined,
        };
        setLocation(loc);
        await AsyncStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({ ...loc, timestamp: Date.now() }));
      } else {
        setError('Could not determine your location. Try enabling Location Services in Settings.');
      }
    } catch (err: any) {
      console.log('[Location] Error getting location:', err?.message);
      setError(err?.message ?? 'Failed to get location. Check your device Settings > Location.');
    } finally {
      setLoading(false);
    }
  }, []);

  const updateRadius = useCallback(async (r: number) => {
    setRadius(r);
    await AsyncStorage.setItem(LOCATION_RADIUS_KEY, String(r));
  }, []);

  const setManualLocation = useCallback(async (city: string, state: string) => {
    const centroid = STATE_CENTROIDS[state.toUpperCase()];
    if (centroid) {
      const loc: UserLocation = {
        latitude: centroid.lat,
        longitude: centroid.lon,
        cityName: city || undefined,
        stateName: state,
      };
      setLocation(loc);
      await AsyncStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({ ...loc, timestamp: Date.now() }));
      console.log('[Location] Manual location set:', city, state);
    }
  }, []);

  useEffect(() => {
    if (!location) {
      void requestLocation();
    } else {
      setLoading(false);
    }
  }, []);

  return {
    location,
    loading,
    error,
    radius,
    refresh: requestLocation,
    updateRadius,
    setManualLocation,
  };
}
