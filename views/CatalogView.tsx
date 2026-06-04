import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  FileText,
  Grid3X3,
  Lightbulb,
  List,
  Loader2,
  Package,
  PencilLine,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  TrendingUp,
  X
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { motion } from 'framer-motion';

import { db } from '../lib/firebase';
import { cn } from '../lib/utils';
import {
  generateListingDescription,
  generateListingOptimization,
  generateProductIdeas,
  type ListingOptimizationPack
} from '../services/gemini';
import {
  CatalogStatusFilter,
  clampNonNegativeInteger,
  clampNonNegativeNumber,
  createNewInventoryForm,
  EtsyAnalyticsSnapshot,
  getRunwayDays,
  parseIntegerInput,
  splitCommaList,
  type EtsyListingPushPatch,
  type NewInventoryForm,
  type ShopProfile,
  type Toast,
  type WorkflowFocus
} from '../app/core';
import {
  deleteLocalBucketRecord,
  isLocalWorkspaceUser,
  patchLocalBucketRecord,
  upsertLocalBucketRecord
} from '../app/localWorkspace';
import { EmptyState, MetricCard, ProfileField, SectionCard, StatusPill } from '../components/shell';
import type { InventoryItem, ProductIdea, TrendAnalysis } from '../types';

type CatalogViewProps = {
  user: User;
  inventory: InventoryItem[];
  trends: TrendAnalysis[];
  shopProfile: ShopProfile;
  etsyAnalytics: EtsyAnalyticsSnapshot;
  showToast: (message: string, type?: Toast['type']) => void;
  pushEtsyListingUpdate: (listingId: string, patch: EtsyListingPushPatch) => Promise<void>;
  workflowFocus: Extract<WorkflowFocus, { tab: 'catalog' }> | null;
};
type InventoryEditorForm = NewInventoryForm;

function buildInventoryEditor(item: InventoryItem | null, shippingLeadTimeDays: number): InventoryEditorForm {
  if (!item) {
    return createNewInventoryForm(shippingLeadTimeDays);
  }

  return {
    name: item.name,
    category: item.category || '',
    description: item.description || '',
    stockLevel: item.stockLevel,
    price: item.price,
    costPrice: item.costPrice || 0,
    reorderPoint: item.reorderPoint || 5,
    monthlySales: item.monthlySales || 0,
    leadTimeDays: item.leadTimeDays || shippingLeadTimeDays,
    materialsText: item.materials?.join(', ') || '',
    sku: item.sku || ''
  };
}

function hasFieldChanges(item: InventoryItem, editor: InventoryEditorForm, shippingLeadTimeDays: number) {
  const normalizedMaterials = splitCommaList(editor.materialsText);
  const normalizedLeadTime = clampNonNegativeInteger(editor.leadTimeDays, shippingLeadTimeDays);

  return (
    item.name !== editor.name.trim() ||
    (item.category || '') !== editor.category.trim() ||
    (item.description || '') !== editor.description.trim() ||
    item.stockLevel !== clampNonNegativeInteger(editor.stockLevel) ||
    item.price !== clampNonNegativeNumber(editor.price) ||
    (item.costPrice || 0) !== clampNonNegativeNumber(editor.costPrice) ||
    (item.reorderPoint || 5) !== clampNonNegativeInteger(editor.reorderPoint, 5) ||
    (item.monthlySales || 0) !== clampNonNegativeInteger(editor.monthlySales) ||
    (item.leadTimeDays || shippingLeadTimeDays) !== normalizedLeadTime ||
    (item.sku || '') !== editor.sku.trim() ||
    JSON.stringify(item.materials || []) !== JSON.stringify(normalizedMaterials)
  );
}

export default function CatalogView({
  user,
  inventory,
  trends,
  shopProfile,
  etsyAnalytics,
  showToast,
  pushEtsyListingUpdate,
  workflowFocus
}: CatalogViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<CatalogStatusFilter>('all');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [showForm, setShowForm] = useState(false);
  const [showIdeas, setShowIdeas] = useState(false);
  const [ideas, setIdeas] = useState<ProductIdea[]>([]);
  const [loadingIdeas, setLoadingIdeas] = useState(false);
  const [loadingDescriptionId, setLoadingDescriptionId] = useState<string | null>(null);
  const [savingSelected, setSavingSelected] = useState(false);
  const [optimizationPack, setOptimizationPack] = useState<ListingOptimizationPack | null>(null);
  const [loadingOptimization, setLoadingOptimization] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newItem, setNewItem] = useState<InventoryEditorForm>(() => createNewInventoryForm(shopProfile.shippingLeadTimeDays));
  const [editor, setEditor] = useState<InventoryEditorForm>(() => createNewInventoryForm(shopProfile.shippingLeadTimeDays));

  const categories = useMemo(() => {
    const values = new Set(inventory.map((item) => item.category).filter(Boolean));
    return ['all', ...Array.from(values)] as string[];
  }, [inventory]);

  const lowStockItems = useMemo(
    () => inventory.filter((item) => item.stockLevel <= (item.reorderPoint || 5)),
    [inventory]
  );
  const liveItems = useMemo(
    () => inventory.filter((item) => !!item.etsyListingId),
    [inventory]
  );
  const backlogItems = useMemo(
    () => inventory.filter((item) => !item.etsyListingId),
    [inventory]
  );
  const criticalRunwayItems = useMemo(
    () => inventory.filter((item) => {
      const runway = getRunwayDays(item);
      const leadTime = item.leadTimeDays || shopProfile.shippingLeadTimeDays;
      return runway !== null && runway <= leadTime + 7;
    }),
    [inventory, shopProfile.shippingLeadTimeDays]
  );
  const totalMargin = useMemo(
    () => inventory.reduce((sum, item) => sum + (item.costPrice ? item.price - item.costPrice : 0), 0),
    [inventory]
  );
  const averageMargin = inventory.length > 0 ? totalMargin / inventory.length : 0;

  const filteredInventory = useMemo(() => {
    return inventory
      .filter((item) => {
        const searchHaystack = [
          item.name,
          item.category,
          item.description,
          item.sku,
          ...(item.materials || []),
          ...(item.tags || [])
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        const matchesSearch = !searchQuery.trim() || searchHaystack.includes(searchQuery.trim().toLowerCase());
        const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
        const matchesStatus = (
          statusFilter === 'all' ||
          (statusFilter === 'restock' && item.stockLevel <= (item.reorderPoint || 5)) ||
          (statusFilter === 'live' && !!item.etsyListingId) ||
          (statusFilter === 'backlog' && !item.etsyListingId)
        );

        return matchesSearch && matchesCategory && matchesStatus;
      })
      .sort((left, right) => {
        const leftLow = left.stockLevel <= (left.reorderPoint || 5) ? 1 : 0;
        const rightLow = right.stockLevel <= (right.reorderPoint || 5) ? 1 : 0;
        if (leftLow !== rightLow) return rightLow - leftLow;

        const leftRunway = getRunwayDays(left) ?? Number.MAX_SAFE_INTEGER;
        const rightRunway = getRunwayDays(right) ?? Number.MAX_SAFE_INTEGER;
        if (leftRunway !== rightRunway) return leftRunway - rightRunway;

        return left.name.localeCompare(right.name);
      });
  }, [categoryFilter, inventory, searchQuery, statusFilter]);

  useEffect(() => {
    if (showForm) return;
    setNewItem(createNewInventoryForm(shopProfile.shippingLeadTimeDays));
  }, [shopProfile.shippingLeadTimeDays, showForm]);

  useEffect(() => {
    if (filteredInventory.length === 0) {
      if (selectedId) {
        setSelectedId(null);
      }
      return;
    }

    if (!selectedId || !filteredInventory.some((item) => item.id === selectedId)) {
      setSelectedId(filteredInventory[0].id || null);
    }
  }, [filteredInventory, selectedId]);

  const selectedItem = inventory.find((item) => item.id === selectedId) || filteredInventory[0] || null;
  const selectedItemHasChanges = selectedItem
    ? hasFieldChanges(selectedItem, editor, shopProfile.shippingLeadTimeDays)
    : false;
  const selectedMetric = useMemo(
    () => etsyAnalytics.listingMetrics.find((metric) => metric.listingId === selectedItem?.etsyListingId) || null,
    [etsyAnalytics.listingMetrics, selectedItem?.etsyListingId]
  );

  useEffect(() => {
    setEditor(buildInventoryEditor(selectedItem, shopProfile.shippingLeadTimeDays));
  }, [selectedItem?.id, selectedItem, shopProfile.shippingLeadTimeDays]);

  useEffect(() => {
    setOptimizationPack(null);
  }, [selectedItem?.id]);

  useEffect(() => {
    if (!workflowFocus) return;

    setViewMode('list');
    setShowForm(false);
    setStatusFilter(workflowFocus.statusFilter || 'all');

    if (workflowFocus.searchQuery !== undefined) {
      setSearchQuery(workflowFocus.searchQuery);
    }

    if (workflowFocus.itemId || workflowFocus.etsyListingId) {
      const target = inventory.find((item) =>
        item.id === workflowFocus.itemId
        || (!!workflowFocus.etsyListingId && item.etsyListingId === workflowFocus.etsyListingId)
      );
      setSelectedId(target?.id || workflowFocus.itemId || null);
    }
  }, [inventory, workflowFocus]);

  const resetNewItem = () => {
    setNewItem(createNewInventoryForm(shopProfile.shippingLeadTimeDays));
  };

  const saveNewItem = async () => {
    if (!newItem.name.trim()) {
      showToast('Give the item a name before saving it.', 'info');
      return;
    }

    try {
      const inventoryPayload = {
        name: newItem.name.trim(),
        category: newItem.category.trim(),
        description: newItem.description.trim(),
        stockLevel: clampNonNegativeInteger(newItem.stockLevel),
        price: clampNonNegativeNumber(newItem.price),
        costPrice: clampNonNegativeNumber(newItem.costPrice),
        reorderPoint: clampNonNegativeInteger(newItem.reorderPoint, 5),
        monthlySales: clampNonNegativeInteger(newItem.monthlySales),
        leadTimeDays: clampNonNegativeInteger(newItem.leadTimeDays, shopProfile.shippingLeadTimeDays),
        materials: splitCommaList(newItem.materialsText),
        sku: newItem.sku.trim(),
        source: 'manual' as const,
        ownerId: user.uid
      };

      if (isLocalWorkspaceUser(user)) {
        const timestamp = new Date().toISOString();
        upsertLocalBucketRecord(user.uid, 'inventory', {
          ...inventoryPayload,
          updatedAt: timestamp,
          createdAt: timestamp
        });
      } else {
        await addDoc(collection(db, 'inventory'), {
          ...inventoryPayload,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp()
        });
      }

      resetNewItem();
      setShowForm(false);
      showToast('Catalog item added', 'success');
    } catch (error) {
      console.error('Catalog item creation failed:', error);
      showToast('Unable to save this catalog item right now', 'error');
    }
  };

  const updateStock = async (item: InventoryItem, nextStock: number) => {
    if (!item.id) return;

    const safeStockLevel = Math.max(0, nextStock);

    try {
      if (item.etsyListingId) {
        await pushEtsyListingUpdate(item.etsyListingId, { stockLevel: safeStockLevel });
      }

      if (isLocalWorkspaceUser(user)) {
        patchLocalBucketRecord(user.uid, 'inventory', item.id, {
          stockLevel: safeStockLevel,
          updatedAt: new Date().toISOString()
        });
      } else {
        await updateDoc(doc(db, 'inventory', item.id), {
          stockLevel: safeStockLevel,
          updatedAt: serverTimestamp()
        });
      }

      showToast(
        item.etsyListingId ? 'Stock updated in Etsy and EtsyHelper' : 'Stock updated',
        'success'
      );
    } catch (error) {
      console.error('Stock update failed:', error);
      showToast(error instanceof Error ? error.message : 'Unable to update stock right now', 'error');
    }
  };

  const deleteItem = async (item: InventoryItem) => {
    if (!item.id) return;
    if (item.etsyListingId) {
      showToast('Live Etsy listings cannot be deleted here yet. Archive or remove them in Etsy first.', 'info');
      return;
    }

    try {
      if (isLocalWorkspaceUser(user)) {
        deleteLocalBucketRecord(user.uid, 'inventory', item.id);
      } else {
        await deleteDoc(doc(db, 'inventory', item.id));
      }
      if (selectedId === item.id) {
        setSelectedId(null);
      }
      showToast('Catalog item removed', 'info');
    } catch (error) {
      console.error('Catalog item delete failed:', error);
      showToast('Unable to remove this catalog item right now', 'error');
    }
  };

  const generateIdeas = async () => {
    setLoadingIdeas(true);
    try {
      const result = await generateProductIdeas(
        inventory.map((item) => item.name),
        trends.map((trend) => trend.keyword)
      );
      setIdeas(result.ideas || []);
      setShowIdeas(true);
    } catch (error) {
      console.error('Product idea generation failed:', error);
      showToast('Unable to generate product ideas right now', 'error');
    } finally {
      setLoadingIdeas(false);
    }
  };

  const addIdeaToCatalog = async (idea: ProductIdea) => {
    const normalizedIdeaName = idea.name.trim().toLowerCase();
    const existing = inventory.find((item) => item.name.trim().toLowerCase() === normalizedIdeaName);
    if (existing) {
      setSelectedId(existing.id || null);
      showToast('That idea already exists in the catalog. I selected the existing record instead.', 'info');
      return;
    }

    try {
      const inventoryPayload = {
        name: idea.name,
        category: shopProfile.niche || 'New concept',
        description: `${idea.description}${idea.reasoning ? `\n\nWhy it fits: ${idea.reasoning}` : ''}`,
        stockLevel: 0,
        price: clampNonNegativeNumber(idea.estimatedPrice),
        costPrice: 0,
        reorderPoint: 5,
        monthlySales: 0,
        leadTimeDays: clampNonNegativeInteger(shopProfile.shippingLeadTimeDays, 5),
        materials: [],
        sku: '',
        source: 'manual' as const,
        ownerId: user.uid
      };

      if (isLocalWorkspaceUser(user)) {
        const timestamp = new Date().toISOString();
        upsertLocalBucketRecord(user.uid, 'inventory', {
          ...inventoryPayload,
          updatedAt: timestamp,
          createdAt: timestamp
        });
      } else {
        await addDoc(collection(db, 'inventory'), {
          ...inventoryPayload,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp()
        });
      }
      showToast('Idea added to the catalog backlog', 'success');
    } catch (error) {
      console.error('Idea backlog save failed:', error);
      showToast('Unable to add this idea to the catalog backlog right now', 'error');
    }
  };

  const draftDescriptionForItem = async (item: InventoryItem) => {
    if (!item.id) return;
    setLoadingDescriptionId(item.id);
    setSelectedId(item.id);

    try {
      const description = await generateListingDescription(item.name, item.category, item.materials);
      setEditor((current) => ({ ...current, description }));
      showToast('AI description drafted. Review it in the detail panel before saving.', 'success');
    } catch (error) {
      console.error('Description generation failed:', error);
      showToast(error instanceof Error ? error.message : 'Unable to generate the description right now', 'error');
    } finally {
      setLoadingDescriptionId(null);
    }
  };

  const buildOptimizationPack = async () => {
    if (!selectedItem) return;
    setLoadingOptimization(true);
    try {
      const liveSignal = selectedMetric
        ? `${selectedMetric.views30d || 0} views, ${selectedMetric.favorites30d || 0} favorites, ${selectedMetric.orders30d || 0} orders, ${selectedMetric.conversionRate || 0}% conversion`
        : undefined;
      const pack = await generateListingOptimization({
        shopName: shopProfile.shopName || 'Etsy shop',
        productName: selectedItem.name,
        category: selectedItem.category,
        description: selectedItem.description,
        materials: selectedItem.materials,
        price: selectedItem.price,
        trendKeywords: trends.slice(0, 5).map((trend) => trend.keyword),
        liveSignal
      });
      setOptimizationPack(pack);
      showToast('Listing optimizer is ready to review', 'success');
    } catch (error) {
      console.error('Listing optimization failed:', error);
      showToast('Unable to build listing suggestions right now', 'error');
    } finally {
      setLoadingOptimization(false);
    }
  };

  const applyOptimizationTitle = (title: string) => {
    setEditor((current) => ({ ...current, name: title }));
    showToast('Optimizer title loaded into the editor', 'info');
  };

  const applyOptimizationHook = () => {
    if (!optimizationPack) return;
    setEditor((current) => ({
      ...current,
      description: current.description.trim()
        ? `${optimizationPack.descriptionHook}\n\n${current.description.trim()}`
        : optimizationPack.descriptionHook
    }));
    showToast('Optimizer hook added to the description', 'info');
  };

  const applyOptimizationTags = () => {
    if (!optimizationPack) return;
    const merged = Array.from(new Set([
      ...splitCommaList(editor.materialsText),
      ...optimizationPack.tagIdeas
    ]));
    setEditor((current) => ({ ...current, materialsText: merged.join(', ') }));
    showToast('Optimizer tags loaded into the editor', 'info');
  };

  const saveSelectedItem = async () => {
    if (!selectedItem?.id) return;
    if (!editor.name.trim()) {
      showToast('Name cannot be blank.', 'info');
      return;
    }

    const normalizedLeadTime = clampNonNegativeInteger(editor.leadTimeDays, shopProfile.shippingLeadTimeDays);
    const localPatch = {
      name: editor.name.trim(),
      category: editor.category.trim(),
      description: editor.description.trim(),
      stockLevel: clampNonNegativeInteger(editor.stockLevel),
      price: clampNonNegativeNumber(editor.price),
      costPrice: clampNonNegativeNumber(editor.costPrice),
      reorderPoint: clampNonNegativeInteger(editor.reorderPoint, 5),
      monthlySales: clampNonNegativeInteger(editor.monthlySales),
      leadTimeDays: normalizedLeadTime,
      materials: splitCommaList(editor.materialsText),
      sku: editor.sku.trim(),
      updatedAt: serverTimestamp()
    };

    const etsyPatch: EtsyListingPushPatch = {};
    if (selectedItem.etsyListingId) {
      if (selectedItem.name !== localPatch.name) {
        etsyPatch.title = localPatch.name;
      }
      if ((selectedItem.description || '') !== localPatch.description) {
        etsyPatch.description = localPatch.description;
      }
      if (selectedItem.price !== localPatch.price) {
        etsyPatch.price = localPatch.price;
      }
      if (selectedItem.stockLevel !== localPatch.stockLevel) {
        etsyPatch.stockLevel = localPatch.stockLevel;
      }
    }

    setSavingSelected(true);
    try {
      if (selectedItem.etsyListingId && Object.keys(etsyPatch).length > 0) {
        await pushEtsyListingUpdate(selectedItem.etsyListingId, etsyPatch);
      }

      if (isLocalWorkspaceUser(user)) {
        patchLocalBucketRecord(user.uid, 'inventory', selectedItem.id, {
          ...localPatch,
          updatedAt: new Date().toISOString()
        });
      } else {
        await updateDoc(doc(db, 'inventory', selectedItem.id), localPatch);
      }
      showToast(
        selectedItem.etsyListingId
          ? 'Catalog record saved and mirrored to Etsy'
          : 'Catalog record saved',
        'success'
      );
    } catch (error) {
      console.error('Catalog item save failed:', error);
      showToast(error instanceof Error ? error.message : 'Unable to save this item right now', 'error');
    } finally {
      setSavingSelected(false);
    }
  };

  const renderInventoryCard = (item: InventoryItem) => {
    const lowStock = item.stockLevel <= (item.reorderPoint || 5);
    const runway = getRunwayDays(item);
    const selected = item.id === selectedItem?.id;

    return (
      <div
        key={item.id}
        onClick={() => setSelectedId(item.id || null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setSelectedId(item.id || null);
          }
        }}
        role="button"
        tabIndex={0}
        className={cn(
          'rounded-[1.8rem] border bg-white p-5 text-left shadow-sm transition',
          selected ? 'border-slate-900 ring-2 ring-slate-200' : 'border-slate-200 hover:border-slate-300'
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-black text-slate-950">{item.name}</p>
            {item.category && <p className="mt-2 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">{item.category}</p>}
            {item.etsyListingId && <p className="mt-2 text-[11px] font-black uppercase tracking-[0.22em] text-amber-500">Etsy live</p>}
          </div>
          <StatusPill tone={lowStock ? 'danger' : 'success'}>
            {lowStock ? 'Low stock' : 'Healthy'}
          </StatusPill>
        </div>

        <p className="mt-4 line-clamp-4 text-sm leading-7 text-slate-700">{item.description || 'No description yet.'}</p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Price</p>
            <p className="mt-2 text-xl font-black text-slate-950">${item.price.toFixed(2)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Runway</p>
            <p className="mt-2 text-xl font-black text-slate-950">{runway ? `${runway}d` : 'n/a'}</p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={(event) => {
                event.stopPropagation();
                void updateStock(item, item.stockLevel - 1);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-sm font-black text-slate-600"
            >
              -
            </button>
            <span className="text-lg font-black text-slate-950">{item.stockLevel}</span>
            <button
              onClick={(event) => {
                event.stopPropagation();
                void updateStock(item, item.stockLevel + 1);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-sm font-black text-slate-600"
            >
              +
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={(event) => {
                event.stopPropagation();
                void draftDescriptionForItem(item);
              }}
              className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
            >
              {loadingDescriptionId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation();
                setSelectedId(item.id || null);
              }}
              className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
            >
              <PencilLine className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <SectionCard className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Catalog</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950">Inventory, listing quality, and product pipeline</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
              Track stock, tune listings, and build the next wave of products.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={generateIdeas}
              disabled={loadingIdeas}
              className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-5 py-3 text-xs font-black uppercase tracking-[0.22em] text-amber-700 transition hover:bg-amber-100 disabled:opacity-60"
            >
              {loadingIdeas ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
              Idea lab
            </button>
            <button
              onClick={() => setShowForm((current) => !current)}
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-[0.22em] text-white transition hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              {showForm ? 'Close form' : 'Add item'}
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Catalog size"
            value={inventory.length}
            detail={`${liveItems.length} live Etsy listings, ${backlogItems.length} local records`}
            icon={<Package className="h-5 w-5" />}
            accent="amber"
          />
          <MetricCard
            title="Average margin"
            value={`$${averageMargin.toFixed(0)}`}
            detail="Estimated price minus cost, before fees and shipping"
            icon={<DollarSign className="h-5 w-5" />}
            accent="emerald"
          />
          <MetricCard
            title="Critical runway"
            value={criticalRunwayItems.length}
            detail="Listings likely to hit pressure before your replenishment buffer"
            icon={<TrendingUp className="h-5 w-5" />}
            accent="indigo"
          />
          <MetricCard
            title="Restock pressure"
            value={lowStockItems.length}
            detail={lowStockItems.length > 0 ? 'Immediate stock decisions needed' : 'No urgent stock-outs flagged'}
            icon={<AlertTriangle className="h-5 w-5" />}
            accent="rose"
          />
        </div>

        {showForm && (
          <div className="mt-6 rounded-[1.9rem] border border-slate-200 bg-slate-50 p-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <ProfileField label="Name" value={newItem.name} onChange={(value) => setNewItem((current) => ({ ...current, name: value }))} placeholder="Pressed-flower keepsake frame" />
              <ProfileField label="Category" value={newItem.category} onChange={(value) => setNewItem((current) => ({ ...current, category: value }))} placeholder="Botanical decor" />
              <ProfileField label="SKU" value={newItem.sku} onChange={(value) => setNewItem((current) => ({ ...current, sku: value }))} placeholder="BOT-FRM-001" />
              <ProfileField label="Materials or tags" value={newItem.materialsText} onChange={(value) => setNewItem((current) => ({ ...current, materialsText: value }))} placeholder="glass, oak, dried flowers" />
              <ProfileField label="Sell price" value={String(newItem.price)} onChange={(value) => setNewItem((current) => ({ ...current, price: clampNonNegativeNumber(Number(value) || 0) }))} type="number" placeholder="48" />
              <ProfileField label="Cost price" value={String(newItem.costPrice)} onChange={(value) => setNewItem((current) => ({ ...current, costPrice: clampNonNegativeNumber(Number(value) || 0) }))} type="number" placeholder="18" />
              <ProfileField label="Stock level" value={String(newItem.stockLevel)} onChange={(value) => setNewItem((current) => ({ ...current, stockLevel: clampNonNegativeInteger(parseIntegerInput(value)) }))} type="number" placeholder="12" />
              <ProfileField label="Reorder point" value={String(newItem.reorderPoint)} onChange={(value) => setNewItem((current) => ({ ...current, reorderPoint: clampNonNegativeInteger(parseIntegerInput(value), 5) }))} type="number" placeholder="5" />
              <ProfileField label="Monthly sales estimate" value={String(newItem.monthlySales)} onChange={(value) => setNewItem((current) => ({ ...current, monthlySales: clampNonNegativeInteger(parseIntegerInput(value)) }))} type="number" placeholder="8" />
              <ProfileField label="Lead time (days)" value={String(newItem.leadTimeDays)} onChange={(value) => setNewItem((current) => ({ ...current, leadTimeDays: clampNonNegativeInteger(parseIntegerInput(value), shopProfile.shippingLeadTimeDays) }))} type="number" placeholder="5" />
            </div>
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Description</p>
              <textarea
                value={newItem.description}
                onChange={(event) => setNewItem((current) => ({ ...current, description: event.target.value }))}
                className="h-32 w-full rounded-[1.6rem] border border-slate-200 bg-white p-4 text-sm font-medium leading-7 text-slate-700"
                placeholder="Short internal description or listing angle..."
              />
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => {
                  resetNewItem();
                  setShowForm(false);
                }}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-xs font-black uppercase tracking-[0.22em] text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
              <button
                onClick={saveNewItem}
                className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-[0.22em] text-white transition hover:bg-slate-800"
              >
                <CheckCircle2 className="h-4 w-4" />
                Save item
              </button>
            </div>
          </div>
        )}
      </SectionCard>

      {showIdeas && (
        <SectionCard className="p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Idea lab</p>
              <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">AI-generated product concepts</h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">Use these as starting points for your backlog and shortlist the strongest ideas.</p>
            </div>
            <button onClick={() => setShowIdeas(false)} className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ideas.map((idea, index) => (
              <div key={`${idea.name}-${index}`} className="rounded-[1.8rem] border border-amber-100 bg-amber-50 p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-lg font-black text-slate-950">{idea.name}</p>
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-amber-600 shadow-sm">
                    <Sparkles className="h-4 w-4" />
                  </div>
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-700">{idea.description}</p>
                {idea.reasoning && <p className="mt-3 text-sm leading-6 text-slate-600">{idea.reasoning}</p>}
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xl font-black text-slate-950">${idea.estimatedPrice}</span>
                  <StatusPill tone={idea.demandLevel === 'high' ? 'success' : idea.demandLevel === 'medium' ? 'warning' : 'info'}>
                    {idea.demandLevel} demand
                  </StatusPill>
                </div>
                <button
                  onClick={() => addIdeaToCatalog(idea)}
                  className="mt-5 inline-flex rounded-full bg-slate-950 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-white transition hover:bg-slate-800"
                >
                  Add to backlog
                </button>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_380px]">
        <SectionCard className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-1 items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search name, SKU, category, materials, or description..."
                className="w-full bg-transparent text-sm font-medium text-slate-700"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="rounded-full border border-slate-200 bg-white px-4 py-3 text-[11px] font-black uppercase tracking-[0.2em] text-slate-500"
              >
                {categories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>

              <div className="flex rounded-full border border-slate-200 bg-white p-1">
                <button onClick={() => setViewMode('list')} className={cn('rounded-full px-4 py-2 text-xs font-semibold transition', viewMode === 'list' ? 'bg-slate-950 text-white' : 'text-slate-700')}>
                  <List className="h-4 w-4" />
                </button>
                <button onClick={() => setViewMode('grid')} className={cn('rounded-full px-4 py-2 text-xs font-semibold transition', viewMode === 'grid' ? 'bg-slate-950 text-white' : 'text-slate-700')}>
                  <Grid3X3 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {([
              ['all', 'All items'],
              ['restock', 'Needs restock'],
              ['live', 'Live Etsy'],
              ['backlog', 'Backlog']
            ] as Array<[CatalogStatusFilter, string]>).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setStatusFilter(value)}
                className={cn(
                  'rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.2em] transition',
                  statusFilter === value ? 'bg-slate-950 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-6">
            {filteredInventory.length === 0 ? (
              <EmptyState icon={<Package className="h-6 w-6" />} title="No catalog items match" subtitle="Try another filter or add a new product record." />
            ) : viewMode === 'list' ? (
              <div className="overflow-hidden rounded-[1.8rem] border border-slate-200">
                <table className="w-full text-left">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-5 py-4 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Item</th>
                      <th className="px-5 py-4 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Stock</th>
                      <th className="px-5 py-4 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Runway</th>
                      <th className="px-5 py-4 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Price</th>
                      <th className="px-5 py-4 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Status</th>
                      <th className="px-5 py-4 text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInventory.map((item) => {
                      const runway = getRunwayDays(item);
                      const lowStock = item.stockLevel <= (item.reorderPoint || 5);
                      const margin = item.costPrice ? item.price - item.costPrice : null;
                      const selected = item.id === selectedItem?.id;

                      return (
                        <tr
                          key={item.id}
                          className={cn(
                            'cursor-pointer border-t border-slate-100 bg-white transition hover:bg-slate-50',
                            selected && 'bg-slate-50'
                          )}
                          onClick={() => setSelectedId(item.id || null)}
                        >
                          <td className="px-5 py-5 align-top">
                            <p className="text-sm font-black text-slate-950">{item.name}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {item.category && <StatusPill tone="info">{item.category}</StatusPill>}
                              {item.etsyListingId && <StatusPill tone="info">Etsy live</StatusPill>}
                              {item.sku && <StatusPill tone="info">{item.sku}</StatusPill>}
                              {item.materials?.slice(0, 2).map((material) => <StatusPill key={material} tone="info">{material}</StatusPill>)}
                            </div>
                            {item.description && <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">{item.description}</p>}
                          </td>
                          <td className="px-5 py-5 align-top">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void updateStock(item, item.stockLevel - 1);
                                }}
                                className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-sm font-black text-slate-600"
                              >
                                -
                              </button>
                              <span className="w-10 text-center text-lg font-black text-slate-950">{item.stockLevel}</span>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void updateStock(item, item.stockLevel + 1);
                                }}
                                className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-sm font-black text-slate-600"
                              >
                                +
                              </button>
                            </div>
                            <p className="mt-2 text-xs text-slate-500">Reorder at {item.reorderPoint || 5}</p>
                          </td>
                          <td className="px-5 py-5 align-top">
                            <p className="text-sm font-bold text-slate-900">{runway ? `${runway} days` : 'No demand data'}</p>
                            <p className="mt-2 text-xs text-slate-500">Lead time {item.leadTimeDays || shopProfile.shippingLeadTimeDays} days</p>
                          </td>
                          <td className="px-5 py-5 align-top">
                            <p className="text-sm font-black text-slate-950">${item.price.toFixed(2)}</p>
                            <p className="mt-2 text-xs text-slate-500">{margin !== null ? `$${margin.toFixed(2)} est. margin` : 'No cost data'}</p>
                          </td>
                          <td className="px-5 py-5 align-top">
                            <StatusPill tone={lowStock ? 'danger' : 'success'}>
                              {lowStock ? 'Restock soon' : 'Healthy'}
                            </StatusPill>
                          </td>
                          <td className="px-5 py-5 align-top">
                            <div className="flex gap-2">
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void draftDescriptionForItem(item);
                                }}
                                className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                              >
                                {loadingDescriptionId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                              </button>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedId(item.id || null);
                                }}
                                className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                              >
                                <PencilLine className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {filteredInventory.map((item) => renderInventoryCard(item))}
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard className="p-6">
          {selectedItem ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-500">Detail editor</p>
                  <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">{selectedItem.name}</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <StatusPill tone={selectedItem.etsyListingId ? 'warning' : 'info'}>
                      {selectedItem.etsyListingId ? 'Mirrors Etsy on save' : 'Manual record'}
                    </StatusPill>
                    <StatusPill tone={selectedItem.stockLevel <= (selectedItem.reorderPoint || 5) ? 'danger' : 'success'}>
                      {selectedItem.stockLevel <= (selectedItem.reorderPoint || 5) ? 'Restock needed' : 'Stable'}
                    </StatusPill>
                  </div>
                </div>

                {!selectedItem.etsyListingId && (
                  <button
                    onClick={() => void deleteItem(selectedItem)}
                    className="rounded-full border border-rose-200 p-2 text-rose-500 transition hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="mt-5 grid gap-4">
                <ProfileField label="Name" value={editor.name} onChange={(value) => setEditor((current) => ({ ...current, name: value }))} />
                <ProfileField label="Category" value={editor.category} onChange={(value) => setEditor((current) => ({ ...current, category: value }))} />
                <ProfileField label="SKU" value={editor.sku} onChange={(value) => setEditor((current) => ({ ...current, sku: value }))} placeholder="Internal SKU or bin reference" />
                <ProfileField label="Materials or tags" value={editor.materialsText} onChange={(value) => setEditor((current) => ({ ...current, materialsText: value }))} placeholder="glass, oak, dried flowers" />

                <div className="grid gap-4 sm:grid-cols-2">
                  <ProfileField label="Sell price" value={String(editor.price)} onChange={(value) => setEditor((current) => ({ ...current, price: clampNonNegativeNumber(Number(value) || 0) }))} type="number" />
                  <ProfileField label="Cost price" value={String(editor.costPrice)} onChange={(value) => setEditor((current) => ({ ...current, costPrice: clampNonNegativeNumber(Number(value) || 0) }))} type="number" />
                  <ProfileField label="Stock level" value={String(editor.stockLevel)} onChange={(value) => setEditor((current) => ({ ...current, stockLevel: clampNonNegativeInteger(parseIntegerInput(value)) }))} type="number" />
                  <ProfileField label="Reorder point" value={String(editor.reorderPoint)} onChange={(value) => setEditor((current) => ({ ...current, reorderPoint: clampNonNegativeInteger(parseIntegerInput(value), 5) }))} type="number" />
                  <ProfileField label="Monthly sales" value={String(editor.monthlySales)} onChange={(value) => setEditor((current) => ({ ...current, monthlySales: clampNonNegativeInteger(parseIntegerInput(value)) }))} type="number" />
                  <ProfileField label="Lead time (days)" value={String(editor.leadTimeDays)} onChange={(value) => setEditor((current) => ({ ...current, leadTimeDays: clampNonNegativeInteger(parseIntegerInput(value), shopProfile.shippingLeadTimeDays) }))} type="number" />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Description</p>
                    <button
                      onClick={() => void draftDescriptionForItem(selectedItem)}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                    >
                      {loadingDescriptionId === selectedItem.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                      Draft AI copy
                    </button>
                  </div>
                  <textarea
                    value={editor.description}
                    onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value }))}
                    className="h-48 w-full rounded-[1.6rem] border border-slate-200 bg-white p-4 text-sm font-medium leading-7 text-slate-700"
                    placeholder="Listing angle, production notes, differentiators, or final description..."
                  />
                </div>
              </div>

              <div className="mt-5 rounded-[1.7rem] border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Listing optimizer</p>
                    <p className="mt-2 text-lg font-extrabold text-slate-950">Sharper copy and positioning</p>
                  </div>
                  <button
                    onClick={() => void buildOptimizationPack()}
                    disabled={loadingOptimization}
                    className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-white transition hover:bg-slate-800 disabled:opacity-60"
                  >
                    {loadingOptimization ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Build optimizer
                  </button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Live signal</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {selectedMetric
                        ? `${selectedMetric.views30d || 0} views • ${selectedMetric.favorites30d || 0} favorites • ${selectedMetric.orders30d || 0} orders`
                        : 'No live Etsy metric attached to this record yet.'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Trend context</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {trends.slice(0, 3).map((trend) => trend.keyword).join(' • ') || 'No saved trend scans yet.'}
                    </p>
                  </div>
                </div>

                {optimizationPack ? (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-[1.5rem] border border-amber-100 bg-amber-50 p-4">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-700">Positioning angle</p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{optimizationPack.positioningAngle}</p>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Title ideas</p>
                        <div className="mt-3 space-y-2">
                          {optimizationPack.titleIdeas.map((title) => (
                            <button
                              key={title}
                              onClick={() => applyOptimizationTitle(title)}
                              className="w-full rounded-2xl border border-white bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:border-slate-200 hover:text-slate-950"
                            >
                              {title}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Description hook</p>
                        <p className="mt-3 text-sm leading-6 text-slate-700">{optimizationPack.descriptionHook}</p>
                        <button
                          onClick={applyOptimizationHook}
                          className="mt-3 inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                        >
                          Use hook
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Tag ideas</p>
                          <button
                            onClick={applyOptimizationTags}
                            className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                          >
                            Load tags
                          </button>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {optimizationPack.tagIdeas.map((tag) => (
                            <StatusPill key={tag} tone="info">{tag}</StatusPill>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Merchandising notes</p>
                        <p className="mt-3 text-sm leading-6 text-slate-700">{optimizationPack.pricingNote}</p>
                        <div className="mt-3 space-y-2">
                          {optimizationPack.merchandisingMoves.map((move) => (
                            <p key={move} className="text-sm leading-6 text-slate-600">• {move}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm leading-7 text-slate-600">
                    Build suggestions from live listing context, saved trends, and your current product data.
                  </p>
                )}
              </div>

              <div className="mt-5 flex flex-wrap justify-end gap-3">
                <button
                  onClick={() => setEditor(buildInventoryEditor(selectedItem, shopProfile.shippingLeadTimeDays))}
                  disabled={!selectedItemHasChanges || savingSelected}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-xs font-black uppercase tracking-[0.22em] text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"
                >
                  <X className="h-4 w-4" />
                  Reset
                </button>
                <button
                  onClick={() => void saveSelectedItem()}
                  disabled={!selectedItemHasChanges || savingSelected}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-[0.22em] text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  {savingSelected ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {selectedItem?.etsyListingId ? 'Save & push to Etsy' : 'Save changes'}
                </button>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<PencilLine className="h-6 w-6" />}
              title="Pick a catalog record"
              subtitle="Use the detail editor to refine copy, set restock thresholds, and tighten your catalog data."
            />
          )}
        </SectionCard>
      </div>
    </motion.div>
  );
}
