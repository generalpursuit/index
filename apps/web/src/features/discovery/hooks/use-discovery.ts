import { useQuery, useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
import { recommendationsOptions, searchPeopleOptions } from "../queries";
export function useDiscovery(query: string) {
  const api = useAPI();
  const suggested = useQuery({ ...recommendationsOptions(api), enabled: !query });
  const search = useInfiniteQuery({
    ...searchPeopleOptions(api, query),
    enabled: !!query,
    placeholderData: keepPreviousData,
  });
  return { suggested, search };
}
