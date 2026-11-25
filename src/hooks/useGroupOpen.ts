'use client';

import {createContext, useContext} from 'react';

// whether the folding group around a card is open (settings), true outside one
export const GroupOpen = createContext(true);
export const useGroupOpen = () => useContext(GroupOpen);
