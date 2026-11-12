/* Data source for the chatbot — knitworks-dashboard (static build).
   The chatbot answers from the same data.js module the dashboard renders. */
import * as data from './data.js';

export const getChatData = () => data;
