import {
  getDisplayName,
  getProfilePicture,
} from "applesauce-core/helpers/profile";

import { useObservableValue } from "@/hooks/use-observable-value";
import { eventStore } from "@/lib/nostr";
import { shortNpub } from "@/lib/utils";

export interface Profile {
  name: string;
  picture?: string;
}

export function useProfile(pubkey: string): Profile {
  const profile = useObservableValue(
    () => eventStore.profile(pubkey),
    [pubkey]
  );
  return {
    name: getDisplayName(profile) ?? shortNpub(pubkey),
    picture: getProfilePicture(profile),
  };
}
