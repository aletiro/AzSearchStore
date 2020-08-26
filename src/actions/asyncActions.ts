import { Store } from "../store";
import * as resultsActions from "./resultsActions";
import * as suggestionsActions from "./suggestionsActions";
import * as facetsActions from "./facetsActions";
import * as promise from "es6-promise";
import "isomorphic-fetch";
import {
  buildSearchURI,
  buildSuggestionsURI,
  buildPostBody,
  suggestParameterValidator,
  searchParameterValidator,
} from "../utils/uriHelper";
// todo this should probably be at the entry point of app
promise.polyfill();
import thunk, { ThunkAction } from "redux-thunk";

const userAgent = "AzSearchStore/Preview";

const searchAndDispatch: ThunkAction<
  Promise<void>,
  Store.SearchState,
  {
    resultsActionToDispatch: (
      results: {}[],
      recievedAt: number,
      count?: number
    ) => resultsActions.ResultsAction;
    facetsActionToDispatch: (facets: {
      [key: string]: Store.FacetResult[];
    }) => facetsActions.FacetsAction;
  }
> = (
  dispatch,
  getState,
  { resultsActionToDispatch, facetsActionToDispatch }
) => {
  const searchState: Store.SearchState = getState();
  const service = searchState.config.service;
  const index = searchState.config.index;
  const parameters = searchState.parameters;
  const searchCallback = searchState.config.searchCallback;
  const searchURI = buildSearchURI(searchState.config, parameters);
  let postBody = buildPostBody(
    parameters.searchParameters,
    parameters.input,
    searchParameterValidator,
    searchState.facets
  );
  let headers = new Headers({
    "api-key": searchState.config.queryKey,
    "Content-Type": "application/json",
    "User-Agent": userAgent,
    "x-ms-client-user-agent": userAgent,
  });

  const promises = new Array<Promise<any>>();
  //make a promise for each facet excluding that facet
  //in that case we can execute R(F-f) in order to get all the values of all other facets
  promises.push(
    searchCallback
      ? searchCallback(searchState, postBody)
      : fetch(searchURI, {
          mode: "cors",
          headers: headers,
          method: "POST",
          body: JSON.stringify(postBody),
        })
  );
  Object.keys(searchState.facets.facets).forEach((facetKey) => {
    //create a copy of facets object
    let facet_singlettes = JSON.parse(JSON.stringify(searchState.facets));
    //delete facet filter in order to fetch results for all others
    facet_singlettes.facets[facetKey].filterClause = "";
    //create promise
    postBody = buildPostBody(
      parameters.searchParameters,
      parameters.input,
      searchParameterValidator,
      facet_singlettes
    );
    //remove other facets in order to get only results for this specific facetKey
    postBody.facets = postBody.facets.filter((x: string) => x.startsWith(facetKey));
    promises.push(
      searchCallback
        ? searchCallback(searchState, postBody)
        : fetch(searchURI, {
            mode: "cors",
            headers: headers,
            method: "POST",
            body: JSON.stringify(postBody),
          })
    );
  });
  dispatch(resultsActions.initiateSearch());
  return Promise.all(promises)
    .then(async (response) => {
      //Promise.all keeps sequential order of promises. So the first added promise for all results
      //is also the first response
      var complete_result = await response[0].json();
      for (const [i, res] of Array.from(response.entries())){
        //skip first response, since it's the complete result, not the singlette
        if (i === 0)
            continue;
        //get facet singlette result
        const singlette_result = await res.json();
        const singlette_result_facets = singlette_result["@search.facets"];
        //copy facet singlette result facets to complete facets
        complete_result["@search.facets"] = {
            ...complete_result["@search.facets"], ...singlette_result_facets
        };
  }

      const results = complete_result.value;
      const count = complete_result["@odata.count"];
      dispatch(resultsActionToDispatch(results, Date.now(), count));
      var facets = complete_result["@search.facets"];
      if (facetsActionToDispatch) dispatch(facetsActionToDispatch(facets));
    })
    .catch((error) => {
      dispatch(resultsActions.handleSearchError(error.message));
    });
};

export const fetchSearchResults: ThunkAction<
  Promise<void>,
  Store.SearchState,
  {}
> = (dispatch, getState) => {
  return searchAndDispatch(dispatch, getState, {
    resultsActionToDispatch: resultsActions.recieveResults,
    facetsActionToDispatch: null,
  });
};

export const loadMoreSearchResults: ThunkAction<
  Promise<void>,
  Store.SearchState,
  {}
> = (dispatch, getState) => {
  return searchAndDispatch(dispatch, getState, {
    resultsActionToDispatch: resultsActions.appendResults,
    facetsActionToDispatch: null,
  });
};

export const fetchSearchResultsFromFacet: ThunkAction<
  Promise<void>,
  Store.SearchState,
  {}
> = (dispatch, getState) => {
  return searchAndDispatch(dispatch, getState, {
    resultsActionToDispatch: resultsActions.recieveResults,
    facetsActionToDispatch: facetsActions.updateFacetsValues,
  });
};

export const suggest: ThunkAction<Promise<void>, Store.SearchState, {}> = (
  dispatch,
  getState
) => {
  const searchState: Store.SearchState = getState();
  const service = searchState.config.service;
  const index = searchState.config.index;
  const suggestCallBack = searchState.config.suggestCallback;
  const parameters = searchState.parameters;
  const suggestURI = buildSuggestionsURI(
    searchState.config,
    searchState.parameters
  );
  const postBody = buildPostBody(
    parameters.suggestionsParameters,
    parameters.input,
    suggestParameterValidator
  );
  let headers = new Headers({
    "api-key": searchState.config.queryKey,
    "Content-Type": "application/json",
    "User-Agent": userAgent,
    "x-ms-client-user-agent": userAgent,
  });
  dispatch(suggestionsActions.initiateSuggest());
  const promise = suggestCallBack
    ? suggestCallBack(searchState, postBody)
    : fetch(suggestURI, {
        mode: "cors",
        headers,
        method: "POST",
        body: JSON.stringify(postBody),
      });
  return promise
    .then((response) => response.json())
    .then((json) => {
      const suggestions: {}[] = json["value"];
      dispatch(suggestionsActions.recieveSuggestions(suggestions, Date.now()));
    })
    .catch((error) => {
      dispatch(suggestionsActions.handleSuggestError(error.message));
    });
};
